import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeWhoPlayers,
  parseCvarList,
  parseNextMap,
  parsePlugins,
  parseStatus,
  parseTimeleft,
  parseWho,
} from "../dist/rcon/parse.js";
import { sanitizeLog, sanitizeRcon } from "../dist/rcon/sanitize.js";

const statusText = `hostname     : Escape Server
version      : 1.40.8.1
udp/ip       : 0.0.0.0:27015 (public ip 94.130.242.62:27015)
map          : ze_winter_warehouse_p
players      : 1 humans, 1 bots (64 max)
# userid name steamid connected ping loss state rate adr
# 0 12 "A Player" STEAM_1:1:42 02:03 31 0 active 786432 10.0.0.1:27005
# 1 13 "Bot" BOT 00:10 0 0 active 786432 loopback:0`;

// Captured verbatim from a live CS2 server. Note there is no "map :" line at
// all -- the loaded map only appears in the spawngroups section.
const realStatusText = `Server:  Running [0.0.0.0:27015]
Client:  Disconnected
----- Status -----
@ Current  :  game
source   : console
hostname : CS2 Zombie Escape Mella Server
spawn    : 3
version  : 1.41.8.1/14181 10896 secure  public
steamid  : [G:1:16727510] (85568392936766934)
udp/ip   : 0.0.0.0:27015 (public 94.130.242.62:27015)
os/type  : Linux dedicated
players  : 0 humans, 0 bots (0 max) (not hibernating) (unreserved)
---------spawngroups----
loaded spawngroup(  1)  : SV:  [1: ze_winter_warehouse_p | main lump | mapload]
loaded spawngroup(  2)  : SV:  [2: prefabs/misc/counterterrorist_team_intro | main lump | mapload | point_prefab]
loaded spawngroup(  3)  : SV:  [3: prefabs/misc/terrorist_team_intro | main lump | mapload | point_prefab]
---------players--------
  id     time ping loss      state   rate adr name
#end`;

// Current player-row format captured from CS2 1.41.8.1. Steam IDs are omitted
// from `status` and supplied separately by CS2Fixes' `c_who` table.
const currentStatusWithPlayers = `hostname : Current Format Server
version  : 1.41.8.1/14181 10896 secure public
udp/ip   : 0.0.0.0:27015 (public 203.0.113.10:27015)
players  : 2 humans, 0 bots (0 max) (not hibernating) (unreserved)
---------players--------
  id     time ping loss      state   rate adr name
   0    07:20  179    0     active 786432 192.0.2.10:29415 'Player One'
   1    04:25  164    0     active 786432 192.0.2.11:64031 'Player Two'
#end`;

const currentWhoTable = `c_who output: 2 clients
|----------------------|----------------------------------------------------|-------------------|
|         Name         |                       Flags                        |    Steam64 ID     |
|----------------------|----------------------------------------------------|-------------------|
|      Player Two      |                         -                          | 76561198142120845 |
|      Player One      |                         b                          | 76561199018771835 |
|----------------------|----------------------------------------------------|-------------------|`;

test("sanitizers remove ANSI/chat colors but preserve multiline formatting", () => {
  const input = "\x07pink\tfield\r\n\x1b[31mred\x1b[0m\rnext";
  assert.equal(sanitizeRcon(input), "pink\tfield\nred\nnext");
  assert.equal(sanitizeLog(input), "pink\tfield\nred\nnext");
});

test("parseStatus reads server metadata, counts, addresses, and player rows", () => {
  const parsed = parseStatus(statusText);
  assert.deepEqual(parsed.game, {
    hostname: "Escape Server",
    currentMap: "ze_winter_warehouse_p",
    nextMap: null,
    timeleftSeconds: null,
    players: 1,
    bots: 1,
    maxPlayers: 64,
    publicAddress: "94.130.242.62:27015",
    version: "1.40.8.1",
  });
  assert.equal(parsed.players.length, 2);
  assert.deepEqual(parsed.players[0], {
    userid: "12", name: "A Player", steamid: "STEAM_1:1:42", ping: 31, loss: 0,
    state: "active", time: "02:03", address: "10.0.0.1:27005", isBot: false, isAdmin: false,
  });
  assert.equal(parsed.players[1].isBot, true);
  assert.equal(parsed.players[1].steamid, null);
});

test("parseStatus reads the map from spawngroups when CS2 omits a map line", () => {
  const parsed = parseStatus(realStatusText);
  assert.equal(parsed.game.currentMap, "ze_winter_warehouse_p");
  assert.equal(parsed.game.hostname, "CS2 Zombie Escape Mella Server");
  assert.equal(parsed.game.publicAddress, "94.130.242.62:27015");
  assert.equal(parsed.game.players, 0);
  assert.deepEqual(parsed.players, []);
});

test("parseStatus reads current CS2 player rows and merges the c_who table by name", () => {
  const parsed = parseStatus(currentStatusWithPlayers);
  assert.equal(parsed.game.players, 2);
  assert.equal(parsed.players.length, 2);
  assert.deepEqual(parsed.players[0], {
    userid: "0", name: "Player One", steamid: null, ping: 179, loss: 0,
    state: "active", time: "07:20", address: "192.0.2.10:29415", isBot: false, isAdmin: false,
  });

  assert.deepEqual(parseWho(currentWhoTable), [
    { userid: null, name: "Player Two", steamid: "76561198142120845", isAdmin: false },
    { userid: null, name: "Player One", steamid: "76561199018771835", isAdmin: true },
  ]);
  const merged = mergeWhoPlayers(parsed.players, currentWhoTable);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].steamid, "76561199018771835");
  assert.equal(merged[0].isAdmin, true);
  assert.equal(merged[1].steamid, "76561198142120845");
  assert.equal(merged[1].isAdmin, false);
});

test("parseTimeleft understands the worded CS2Fixes c_timeleft reply", () => {
  assert.equal(parseTimeleft("[CS2Fixes] Timeleft: 37 minutes 4 seconds"), 2224);
  assert.equal(parseTimeleft("[CS2Fixes] Timeleft: 1 hour 2 minutes 3 seconds"), 3723);
  assert.equal(parseTimeleft("[CS2Fixes] Timeleft: 45 seconds"), 45);
  assert.equal(parseTimeleft("[CS2Fixes] Timeleft: 12:34"), 754);
});

test("c_who parser and merge annotate admins without discarding status data", () => {
  const parsed = parseStatus(statusText);
  const who = parseWho('Admin "A Player" [#12] 76561190000000000');
  assert.deepEqual(who, [{ userid: "12", name: "A Player", steamid: "76561190000000000", isAdmin: true }]);
  const merged = mergeWhoPlayers(parsed.players, 'Admin "A Player" [#12] 76561190000000000');
  assert.equal(merged[0].isAdmin, true);
  assert.equal(merged[0].steamid, "76561190000000000");
  assert.equal(merged[0].ping, 31);
});

test("auxiliary response parsers cover time, next map, plugins, and cvarlist", () => {
  assert.equal(parseTimeleft("[CS2Fixes] Timeleft: 12:34"), 754);
  assert.equal(parseTimeleft("Time remaining 1:02:03"), 3723);
  assert.equal(parseTimeleft("No time limit"), null);
  assert.equal(parseNextMap("The next map is: ze_test_v1"), "ze_test_v1");
  assert.deepEqual(parsePlugins(" [01] CS2Fixes (1.20.1) by Vauff\n [02] MultiAddonManager (v1.5.4 @ abc)"), [
    { index: "01", name: "CS2Fixes", version: "1.20.1", author: "Vauff" },
    { index: "02", name: "MultiAddonManager", version: "1.5.4", author: "" },
  ]);
  assert.deepEqual(parseCvarList("hostname : test\nstatus [command]\nhostname : duplicate\nnot a row"), ["hostname", "status"]);
});
