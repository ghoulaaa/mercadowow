// Despliegue en Vercel: una sola función reparte las mismas rutas que Netlify.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { RUTAS, rutaDe, ipDe, despachar, type Api } from "../../vercel/rutas.ts";
import { empaquetar, actual } from "../../vercel/empaquetar.mjs";

const leer = (r: string) => readFileSync(new URL(`../../${r}`, import.meta.url), "utf8");

describe("rutas de Vercel", () => {
  test("cubren exactamente las funciones de Netlify, con el mismo método", () => {
    const dir = new URL("../functions/", import.meta.url);
    const netlify: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      const t = readFileSync(new URL(f, dir), "utf8");
      netlify[t.match(/path: "\/api\/([a-z-]+)"/)![1]] = t.match(/api\.(\w+)\(/)![1];
    }
    assert.deepEqual(RUTAS, netlify);
  });

  test("la ruta sale de la URL original o de la reescrita", () => {
    assert.equal(rutaDe(new URL("https://x/api/mercado?pagina=2")), "mercado");
    assert.equal(rutaDe(new URL("https://x/api?__ruta=perfil-subasta")), "perfil-subasta");
    assert.equal(rutaDe(new URL("https://x/api/index?__ruta=objeto&id=5")), "objeto");
    assert.equal(rutaDe(new URL("https://x/api")), "");
  });

  test("reparte al manejador, sin el parámetro interno y con la IP del visitante", async () => {
    const visto: string[] = [];
    const api: Api = {
      objeto: (req, ip) => { visto.push(req.method, new URL(req.url).pathname + new URL(req.url).search, ip); return new Response("ok"); },
      login: async (req, ip) => new Response(ip + (await req.text())),
    };
    const r = await despachar(new Request("https://x/api?__ruta=objeto&id=5", { headers: { "x-real-ip": "9.9.9.9" } }), api);
    assert.equal(await r.text(), "ok");
    assert.deepEqual(visto, ["GET", "/api/objeto?id=5", "9.9.9.9"]);
    // El cuerpo de un POST llega intacto tras limpiar la URL.
    const p = await despachar(new Request("https://x/api?__ruta=login", { method: "POST", body: "{}", headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }), api);
    assert.equal(await p.text(), "1.2.3.4{}");
    assert.equal(ipDe(new Request("https://x/")), "desconocida");
  });

  test("rutas desconocidas → 404 (también nombres heredados de Object)", async () => {
    for (const u of ["https://x/api/nada", "https://x/api", "https://x/api?__ruta=constructor", "https://x/api/toString"]) {
      const r = await despachar(new Request(u), {} as Api);
      assert.equal(r.status, 404, u);
    }
  });
});

describe("configuración de Vercel", () => {
  const v = JSON.parse(leer("vercel.json"));

  test("publica la página estática y no usa el servidor local", () => {
    assert.equal(v.outputDirectory, "app/static");
    assert.equal(v.framework, null);
    const ignorados = leer(".vercelignore").split(/\r?\n/);
    for (const i of ["app/*.py", "requirements.txt"]) assert.ok(ignorados.includes(i), i);
  });

  test("mismas cabeceras de seguridad que Netlify", () => {
    const toml = leer("netlify.toml");
    for (const { key, value } of v.headers[0].headers) assert.ok(toml.includes(`${key} = "${value}"`), key);
    assert.equal(v.headers[0].headers.length, 4);
  });

  test("api/index.js está al día con el código", async () => {
    assert.equal(actual(), await empaquetar(), "ejecuta `npm run vercel`");
  });
});
