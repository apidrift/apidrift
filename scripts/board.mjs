#!/usr/bin/env node
// API partagée du board. Node seul, aucune dépendance.
// Toute écriture passe par ici : état valide + trace (events).
// Le board est terse : pas de prose, juste l'essentiel structuré.
//
//   node scripts/board.mjs list [--status ready]
//   node scripts/board.mjs board                       # colonnes dérivées + wip
//   node scripts/board.mjs add --us '<json US>'        # ajoute une US au backlog
//   node scripts/board.mjs update --us US-1 --patch '<json partiel>' --actor po
//   node scripts/board.mjs ready --us US-1 --actor architecte
//   node scripts/board.mjs move --us US-1 --to in_progress --actor dev#1
//   node scripts/board.mjs delegate --us US-1 --to dev#1 --payload '<enveloppe>'
//   node scripts/board.mjs report --us US-1 --actor dev#1 --payload '<rapport>'
//   node scripts/board.mjs event --type peer_message --us US-1 --actor dev#1 --target qa --note "..."

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKLOG = join(ROOT, "board", "backlog.json");
const BOARD = join(ROOT, "board", "board.json");
const STATUSES = ["backlog", "ready", "in_progress", "review", "done", "blocked"];
const COLS = ["ready", "in_progress", "review", "done", "blocked"];

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
const fail = (m) => { console.error("erreur: " + m); process.exit(1); };

const args = {};
const argv = process.argv.slice(3);
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];

const cmd = process.argv[2];
const backlog = read(BACKLOG);
const board = read(BOARD);
const us = (id) => backlog.items.find((x) => x.id === id);
const log = (ev) => board.events.push({ ts: new Date().toISOString(), ...ev });
const save = () => { write(BACKLOG, backlog); write(BOARD, board); console.log("ok"); };

switch (cmd) {
  case "list":
    console.log(JSON.stringify(
      args.status ? backlog.items.filter((x) => x.status === args.status) : backlog.items, null, 2));
    break;

  case "board": {
    const cols = Object.fromEntries(COLS.map((c) => [c, backlog.items.filter((x) => x.status === c).map((x) => x.id)]));
    const in_progress = cols.in_progress.length;
    console.log(JSON.stringify({ wip: { in_progress, limit: board.wip_limit }, columns: cols }, null, 2));
    break;
  }

  case "add": {
    if (!args.us) fail("--us '<json>' requis");
    backlog.items.push(JSON.parse(args.us));
    save();
    break;
  }

  case "update": {
    const it = us(args.us); if (!it) fail("US introuvable: " + args.us);
    if (!args.patch) fail("--patch '<json partiel>' requis");
    if (!args.actor) fail("--actor requis (pas de defaut : l'auteur d'une reecriture doit etre trace)");
    const patch = JSON.parse(args.patch);
    for (const k of ["id", "status"]) if (k in patch) fail("champ non modifiable via update: " + k);
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, it[k]]));
    Object.assign(it, patch);
    log({ type: "update", actor: args.actor, us: it.id,
          payload: { fields: Object.keys(patch), before, after: patch }, note: args.note });
    save();
    break;
  }

  case "ready": {
    const it = us(args.us); if (!it) fail("US introuvable: " + args.us);
    it.status = "ready";
    log({ type: "move", actor: args.actor || "architecte", us: it.id, note: "ready" });
    save();
    break;
  }

  case "move": {
    const it = us(args.us); if (!it) fail("US introuvable: " + args.us);
    if (!STATUSES.includes(args.to)) fail("statut invalide: " + args.to);
    if (args.to === "in_progress") {
      const n = backlog.items.filter((x) => x.status === "in_progress").length;
      if (n >= board.wip_limit) fail("WIP atteint (" + board.wip_limit + ")");
    }
    const from = it.status;
    it.status = args.to;
    if (args.actor) it.assignee = args.actor;
    log({ type: "move", actor: args.actor || "orchestrateur", us: it.id, note: from + ">" + args.to });
    save();
    break;
  }

  case "delegate":
    log({ type: "delegate", actor: "orchestrateur", target: args.to, us: args.us,
          payload: args.payload ? JSON.parse(args.payload) : undefined });
    save();
    break;

  case "report":
    log({ type: "report", actor: args.actor, us: args.us,
          payload: args.payload ? JSON.parse(args.payload) : undefined });
    save();
    break;

  case "event":
    log({ type: args.type, actor: args.actor, target: args.target, us: args.us, note: args.note });
    save();
    break;

  default:
    console.log("commandes: list | board | add | update | ready | move | delegate | report | event");
}
