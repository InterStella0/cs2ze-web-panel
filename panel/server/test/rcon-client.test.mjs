import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { RconClient } from "../dist/rcon/client.js";
import { PacketFramer, PacketType, encodePacket } from "../dist/rcon/protocol.js";

async function mockRcon(t) {
  const commands = [];
  const big = Array.from({ length: 18_000 }, (_, index) => `test_cvar_${index} : 0 : sv`).join("\n");
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const framer = new PacketFramer();
    socket.on("data", (chunk) => {
      for (const packet of framer.push(chunk)) {
        if (packet.type === PacketType.AUTH) {
          socket.write(encodePacket(packet.body === "secret" ? packet.id : -1, PacketType.AUTH_RESPONSE, ""));
        } else if (packet.body === "") {
          socket.write(encodePacket(packet.id, PacketType.RESPONSE_VALUE, ""));
        } else {
          commands.push(packet.body);
          socket.write(encodePacket(packet.id, PacketType.RESPONSE_VALUE, packet.body === "cvarlist" ? big : `reply:${packet.body}`));
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { server, commands, big };
}

test("RconClient authenticates from one packet, serializes commands, and preserves a large response", async (t) => {
  const mock = await mockRcon(t);
  const address = mock.server.address();
  assert.equal(typeof address, "object");
  const client = new RconClient({ host: "127.0.0.1", port: address.port, getPassword: async () => "secret" });
  t.after(() => client.close());

  const [one, two] = await Promise.all([client.exec("one"), client.exec("two")]);
  assert.equal(one, "reply:one");
  assert.equal(two, "reply:two");
  assert.deepEqual(mock.commands, ["one", "two"]);

  const large = await client.exec("cvarlist", 10_000);
  assert.ok(Buffer.byteLength(large) > 400_000);
  assert.equal(large, mock.big);
  assert.equal(large.split("\n").length, 18_000);
});

test("RconClient blocks an empty password before opening a socket", async () => {
  const client = new RconClient({ host: "127.0.0.1", port: 1, getPassword: async () => null });
  await assert.rejects(client.exec("status"), /CS2_RCONPW is empty/);
  client.close();
});
