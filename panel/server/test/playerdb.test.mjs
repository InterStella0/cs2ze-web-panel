import assert from "node:assert/strict";
import test from "node:test";
import { fetchPlayerDbAvatar, isPlayerDbSteamId } from "../dist/playerdb.js";

const steamid = "76561197960435530";

test("isPlayerDbSteamId accepts RCON Steam ID formats without accepting arbitrary paths", () => {
  assert.equal(isPlayerDbSteamId(steamid), true);
  assert.equal(isPlayerDbSteamId("STEAM_1:1:42"), true);
  assert.equal(isPlayerDbSteamId("[U:1:85]"), true);
  assert.equal(isPlayerDbSteamId("not-a-steam-id"), false);
  assert.equal(isPlayerDbSteamId("../steam/76561197960435530"), false);
});

test("fetchPlayerDbAvatar returns PlayerDB's HTTPS avatar and identifies the client", async () => {
  let request;
  const avatar = await fetchPlayerDbAvatar(steamid, async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      success: true,
      data: { player: { avatar: "https://avatars.fastly.steamstatic.com/example_full.jpg" } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.equal(avatar, "https://avatars.fastly.steamstatic.com/example_full.jpg");
  assert.equal(request.url, `https://playerdb.co/api/player/steam/${steamid}`);
  assert.match(request.init.headers["user-agent"], /cs2ze-panel/);
});

test("fetchPlayerDbAvatar rejects failed, malformed, and insecure avatar responses", async () => {
  const cases = [
    new Response("{}", { status: 404 }),
    new Response(JSON.stringify({ success: false, data: { player: { avatar: "https://example.com/avatar.jpg" } } })),
    new Response(JSON.stringify({ success: true, data: { player: { avatar: "http://example.com/avatar.jpg" } } })),
    new Response(JSON.stringify({ success: true, data: {} })),
  ];

  for (const response of cases) {
    assert.equal(await fetchPlayerDbAvatar(steamid, async () => response), null);
  }
});
