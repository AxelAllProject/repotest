'use strict';

/* =========================================================
   Colis & Commits — apprendre Git au bureau de poste
   Aucun framework : un mini-Git simulé + des missions.
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const union = (...objs) => [...new Set(objs.flatMap(o => Object.keys(o || {})))].sort();
const pl = (n, w) => `${n} ${w}${n > 1 && !/[sx]$/.test(w) ? 's' : ''}`;
const K = s => `<code class="cmd" title="Cliquer pour l'écrire dans le terminal">${esc(s)}</code>`;
const URL_CENTRAL = 'https://poste-centrale.exemple/colis.git';
const SAVE_KEY = 'colis-commits-v1';

/* ---------------------------------------------------------
   1. L'état du « dépôt »
   --------------------------------------------------------- */
let S;          // état courant
let quiet = false;

function freshState() {
  return {
    init: false,
    work: {},       // l'établi : nom -> version
    index: {},      // le carton : nom -> version (ce que contiendra le prochain colis)
    commits: {},    // tous les colis fermés : id -> {id, msg, tree, parents, author, branch, t}
    branches: {},   // tournées locales : nom -> id du dernier colis
    head: 'main',   // 📍 vous êtes ici
    remote: null,   // {name, url, branches}
    tracking: {},   // 'origin/main' -> id (ce qu'on sait du central)
    author: 'Vous',
    ran: new Set(),
    flags: {},
    fx: {},
    seq: 0,
    clock: 0,
  };
}

const headId = () => S.branches[S.head] ?? null;
const treeOf = id => (id ? S.commits[id].tree : {});
const headTree = () => treeOf(headId());

function ancestors(id) {
  const seen = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...S.commits[c].parents);
  }
  return seen;
}
const isAnc = (a, b) => !!a && !!b && ancestors(b).has(a);

function reachable(ids) {
  const set = new Set();
  ids.filter(Boolean).forEach(id => ancestors(id).forEach(x => set.add(x)));
  return set;
}
const localSet = () => reachable([...Object.values(S.branches), ...Object.values(S.tracking)]);
const remoteSet = () => (S.remote ? reachable(Object.values(S.remote.branches)) : new Set());
const localCount = () => reachable(Object.values(S.branches)).size;

function status() {
  const H = headTree(), I = S.index, W = S.work;
  const staged = [], unstaged = [], untracked = [];
  for (const n of union(H, I)) {
    if (H[n] !== I[n]) staged.push({ n, k: !(n in H) ? 'nouveau' : !(n in I) ? 'supprimé' : 'modifié' });
  }
  for (const n of union(I, W)) {
    if (!(n in I)) untracked.push(n);
    else if (W[n] !== I[n]) unstaged.push({ n, k: !(n in W) ? 'supprimé' : 'modifié' });
  }
  return { staged, unstaged, untracked };
}
const isDirty = () => { const st = status(); return st.staged.length + st.unstaged.length > 0; };

function untrackedMap() {
  const m = {};
  status().untracked.forEach(n => (m[n] = S.work[n]));
  return m;
}
function applyTree(tree, keep) {
  S.index = { ...tree };
  S.work = { ...keep, ...tree };
}

function newId() {
  let id;
  do id = Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
  while (S.commits[id]);
  return id;
}
function makeCommit(msg, tree, parents, author = S.author, branch = S.head) {
  const id = newId();
  S.commits[id] = { id, msg, tree: { ...tree }, parents, author, branch, t: ++S.clock };
  return id;
}

function fx(key, val) {
  if (Array.isArray(val)) S.fx[key] = [...(S.fx[key] || []), ...val];
  else S.fx[key] = val;
}

/* ---------------------------------------------------------
   2. Sortie du terminal
   --------------------------------------------------------- */
const outEl = $('#term-out');
function print(text, cls = '') {
  if (quiet) return;
  const d = document.createElement('div');
  d.className = 'ln ' + cls;
  d.textContent = text;
  outEl.appendChild(d);
}
const post = t => print('📮 ' + t, 'post');
const err = t => print(t, 'err');

function promptText() {
  return `facteur@poste:~/atelier${S.init ? ` (${S.head})` : ''} $`;
}

/* ---------------------------------------------------------
   3. Les commandes
   --------------------------------------------------------- */
function tokenize(line) {
  line = line.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const t = [];
  let m;
  while ((m = re.exec(line))) t.push(m[1] ?? m[2] ?? m[3]);
  return t;
}

const validName = n => /^[\w][\w.\-/]*$/.test(n) && !n.includes('..');

function expand(patterns, pool) {
  const out = [];
  for (const p of patterns) {
    if (p === '.' || p === '-A' || p === '--all' || p === '*') out.push(...pool);
    else if (p.includes('*')) {
      const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const hit = pool.filter(n => re.test(n));
      out.push(...(hit.length ? hit : [p]));
    } else out.push(p);
  }
  return [...new Set(out)];
}

function run(line) {
  line = line.trim();
  if (!line) return;
  if (!quiet) {
    const d = document.createElement('div');
    d.className = 'ln cmd';
    d.innerHTML = `<span class="pr">${esc(promptText())}</span> ${esc(line)}`;
    outEl.appendChild(d);
  }
  const [c, ...a] = tokenize(line);
  const fn = CMDS[c];
  if (!fn) {
    err(`${c} : commande introuvable`);
    post('Tapez help pour voir les commandes du guichet.');
    return;
  }
  fn(a);
}

const CMDS = {
  help() {
    print("Commandes de l'atelier :", 'hl');
    print('  touch <fichier>        fabriquer un nouvel objet');
    print('  edit <fichier>         retoucher un objet (le modifier)');
    print('  rm <fichier>           jeter un objet');
    print("  ls                     regarder l'établi");
    print('  clear                  nettoyer le terminal');
    print('Commandes Git :', 'hl');
    print('  git init               ouvrir son bureau de poste');
    print("  git status             faire l'inventaire");
    print('  git add <fichier|.>    mettre dans le carton');
    print('  git commit -m "…"      fermer et étiqueter le carton');
    print('  git log [--oneline]    lire le registre des colis');
    print('  git diff [--staged]    voir les retouches');
    print('  git restore [--staged] <fichier>');
    print('  git branch [nom]       lister / créer une tournée');
    print('  git switch [-c] <nom>  changer de tournée');
    print('  git merge <nom>        réunir deux tournées');
    print('  git remote add origin <adresse>');
    print('  git push | git fetch | git pull');
  },
  clear() { outEl.innerHTML = ''; },
  ls() {
    const names = Object.keys(S.work).sort();
    if (!names.length) { print('(établi vide)', 'dim'); return; }
    print(names.join('   '));
  },
  touch(a) {
    if (!a.length) return err('touch : opérande de fichier manquant');
    for (const n of a) {
      if (!validName(n)) { err(`touch : nom de fichier invalide « ${n} »`); continue; }
      if (n in S.work) { print(`(${n} existe déjà — utilisez edit ${n} pour le modifier)`, 'dim'); continue; }
      S.work[n] = ++S.seq;
      fx('wiggle', [n]);
      post(`🛠️ Nouvel objet sur l'établi : ${n}. La Poste ne le connaît pas encore (fichier non suivi).`);
    }
  },
  edit(a) {
    if (!a.length) return err('edit : quel fichier ? ex. edit lettre.txt');
    for (const n of a) {
      if (!(n in S.work)) { err(`edit : ${n} : aucun fichier de ce nom`); continue; }
      S.work[n] = ++S.seq;
      S.flags.edited = true;
      fx('wiggle', [n]);
      post(S.init && n in S.index
        ? `✏️ Vous retouchez ${n}. La version sur l'établi est différente de celle du carton : il faudra refaire git add.`
        : `✏️ Vous retouchez ${n}.`);
    }
  },
  rm(a) {
    if (!a.length) return err('rm : opérande manquant');
    for (const n of a) {
      if (!(n in S.work)) { err(`rm : impossible de supprimer '${n}' : aucun fichier de ce nom`); continue; }
      delete S.work[n];
      post(`🗑️ ${n} quitte l'établi.${n in S.index ? ' Pour que la suppression parte dans un colis : git add ' + n + ' puis commit.' : ''}`);
    }
  },
  git(a) {
    const [sub, ...rest] = a;
    if (!sub || sub === 'help' || sub === '--help') return CMDS.help();
    if (sub === '--version' || sub === 'version') return print('git version 2.47.0 (édition postale)');
    const fn = GIT[sub];
    if (!fn) {
      err(`git : '${sub}' n'est pas une commande git. Voir 'git help'.`);
      post("Ce guichet ne connaît pas cette opération. Tapez help pour la liste.");
      return;
    }
    if (!['init', 'clone', 'config'].includes(sub) && !S.init) {
      err("fatal: ni ceci ni aucun de ses dossiers parents n'est un dépôt git : .git");
      post("Il n'y a pas encore de bureau de poste ici ! Commencez par git init.");
      return;
    }
    if (!quiet) S.ran.add(sub);
    fn(rest);
  },
  // interne : utilisé par les missions pour simuler un·e collègue
  '@colleague'(a) {
    const [file, msg] = a;
    const base = S.remote.branches.main;
    const tree = { ...treeOf(base), [file]: ++S.seq };
    S.remote.branches.main = makeCommit(msg, tree, base ? [base] : [], 'Camille', 'main');
  },
};
CMDS.modifier = CMDS.edit;
CMDS.cls = CMDS.clear;
CMDS.aide = CMDS.help;

const GIT = {
  init() {
    if (S.init) {
      print('Dépôt Git existant réinitialisé dans ~/atelier/.git/');
      post('Le bureau de poste était déjà ouvert : rien de perdu.');
      return;
    }
    S.init = true;
    S.branches = { main: null };
    S.head = 'main';
    print('Dépôt Git vide initialisé dans ~/atelier/.git/');
    post("🏤 Votre bureau de poste est ouvert ! Un entrepôt secret (.git) vient d'apparaître. Il gardera tous vos colis.");
  },

  clone() {
    print('Dans ce jeu, on ouvre son propre bureau avec git init.', 'dim');
    post("git clone = recopier chez soi tout un bureau central existant, avec tous ses colis et son registre.");
  },

  config(a) {
    const i = a.indexOf('user.name');
    if (i >= 0 && a[i + 1]) {
      S.author = a[i + 1];
      post(`🖊️ Vos prochaines étiquettes seront signées « ${S.author} ».`);
    } else post("Réglages du guichet notés. (Essayez : git config user.name \"Votre nom\")");
  },

  status() {
    const st = status();
    const hid = headId();
    S.flags.sawStatus = true;
    if (st.untracked.length) S.flags.sawUntracked = true;
    if (st.staged.length) S.flags.sawStaged = true;

    print(`Sur la branche ${S.head}`);
    const tr = S.remote && S.tracking[`${S.remote.name}/${S.head}`];
    if (tr && hid) {
      const A = ancestors(hid), B = ancestors(tr);
      const ahead = [...A].filter(x => !B.has(x)).length;
      const behind = [...B].filter(x => !A.has(x)).length;
      const ref = `${S.remote.name}/${S.head}`;
      if (!ahead && !behind) print(`Votre branche est à jour avec '${ref}'.`);
      else if (!behind) {
        print(`Votre branche est en avance sur '${ref}' de ${pl(ahead, 'commit')}.`);
        print('  (utilisez "git push" pour publier vos commits locaux)', 'dim');
      } else if (!ahead) {
        print(`Votre branche est en retard sur '${ref}' de ${pl(behind, 'commit')}.`);
        print('  (utilisez "git pull" pour mettre à jour votre branche locale)', 'dim');
      } else print(`Votre branche et '${ref}' ont divergé.`);
    }
    if (!hid) { print(''); print('Aucun commit'); }
    if (st.staged.length) {
      print(''); print('Modifications qui seront validées :');
      print('  (utilisez "git restore --staged <fichier>..." pour désindexer)', 'dim');
      st.staged.forEach(({ n, k }) => print(`\t${(k + ' :').padEnd(12)} ${n}`, 'ok'));
    }
    if (st.unstaged.length) {
      print(''); print('Modifications qui ne seront pas validées :');
      print('  (utilisez "git add <fichier>..." pour mettre à jour ce qui sera validé)', 'dim');
      st.unstaged.forEach(({ n, k }) => print(`\t${(k + ' :').padEnd(12)} ${n}`, 'err'));
    }
    if (st.untracked.length) {
      print(''); print('Fichiers non suivis :');
      print('  (utilisez "git add <fichier>..." pour inclure dans ce qui sera validé)', 'dim');
      st.untracked.forEach(n => print(`\t${n}`, 'err'));
    }
    const clean = !st.staged.length && !st.unstaged.length && !st.untracked.length;
    if (clean) {
      print('');
      print('rien à valider, la copie de travail est propre');
      S.flags.sawClean = true;
    }
    const parts = [];
    if (st.staged.length) parts.push(`📦 ${pl(st.staged.length, 'objet')} dans le carton`);
    if (st.unstaged.length) parts.push(`✏️ ${pl(st.unstaged.length, 'retouche')} pas encore dans le carton`);
    if (st.untracked.length) parts.push(`❓ ${pl(st.untracked.length, 'objet')} inconnu${st.untracked.length > 1 ? 's' : ''} de la Poste`);
    post('Inventaire : ' + (clean ? "tout est rangé, rien ne traîne sur l'établi ✨" : parts.join(' · ')));
  },

  add(a) {
    const files = a.filter(x => !x.startsWith('-') || x === '-A' || x === '--all');
    if (!files.length) {
      err('Rien de spécifié, rien n\'a été ajouté.');
      post("Précisez quoi mettre dans le carton : git add lettre.txt (ou git add . pour tout l'établi).");
      return;
    }
    const pool = union(S.work, S.index);
    const moved = [];
    for (const f of expand(files, pool)) {
      if (f in S.work) {
        if (S.index[f] !== S.work[f]) moved.push(f);
        S.index[f] = S.work[f];
      } else if (f in S.index) {
        delete S.index[f];
        moved.push(f);
      } else {
        err(`fatal: le chemin '${f}' ne correspond à aucun fichier`);
        return;
      }
    }
    if (!moved.length) { post('Rien de nouveau : le carton contenait déjà ces objets tels quels.'); return; }
    fx('drop', moved);
    post(`📦 Dans le carton : ${moved.join(', ')}. Le carton est encore ouvert, vous pouvez continuer à le remplir.`);
    if (moved.some(n => /motdepasse|secret|\.env/i.test(n))) {
      post("🚨 Attention, un secret vient d'entrer dans le carton ! Ressortez-le avant de fermer : git restore --staged <fichier>");
    }
  },

  commit(a) {
    let msg = null, all = false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-m' || x === '--message') msg = a[++i] ?? '';
      else if (x === '-am' || x === '-ma') { all = true; msg = a[++i] ?? ''; }
      else if (x === '-a' || x === '--all') all = true;
      else if (/^-m./.test(x)) msg = x.slice(2);
      else if (msg !== null) msg += ' ' + x;
    }
    if (all) for (const n of Object.keys(S.index)) {
      if (n in S.work) S.index[n] = S.work[n];
      else delete S.index[n];
    }
    const st = status();
    if (!st.staged.length) {
      print(`Sur la branche ${S.head}`);
      print('rien à valider' + (st.unstaged.length || st.untracked.length ? ' (utilisez "git add")' : ''));
      post('Le carton est vide ! On ne ferme pas un carton vide : utilisez d\'abord git add.');
      return;
    }
    if (msg === null || !msg.trim()) {
      err('Abandon de la validation dû à un message de validation vide.');
      post('Un colis sans étiquette ? Jamais ! Ajoutez un message : git commit -m "Ce que contient le colis"');
      return;
    }
    const parent = headId();
    const id = makeCommit(msg.trim(), S.index, parent ? [parent] : []);
    S.branches[S.head] = id;
    fx('seal', id);
    print(`[${S.head}${parent ? '' : ' (commit racine)'} ${id}] ${msg.trim()}`);
    print(` ${pl(st.staged.length, 'fichier')} modifié${st.staged.length > 1 ? 's' : ''}`);
    post(`🔒 Carton fermé, scotché et étiqueté « ${msg.trim()} » (n° de suivi #${id}). Il est rangé dans VOTRE entrepôt : il n'est pas encore envoyé !`);
    if (Object.keys(S.index).some(n => /motdepasse|secret/i.test(n))) {
      post('😱 Ce colis contient un secret… Dans la vraie vie, il faudrait réécrire l\'historique. Ici : bouton ↺ Recommencer.');
    }
  },

  log(a) {
    const one = a.includes('--oneline');
    const all = a.includes('--all');
    const start = all ? [...Object.values(S.branches), ...Object.values(S.tracking)] : [headId()];
    const set = reachable(start);
    if (!set.size) {
      err(`fatal: votre branche actuelle '${S.head}' ne contient encore aucun commit`);
      post("Le registre est vide : aucun colis fermé pour l'instant.");
      return;
    }
    const list = [...set].map(id => S.commits[id]).sort((x, y) => y.t - x.t);
    for (const c of list) {
      const refs = refNames(c.id);
      const deco = refs.length ? ` (${refs.join(', ')})` : '';
      if (one) print(`${c.id}${deco} ${c.msg}`, 'hl');
      else {
        print(`commit ${c.id}${deco}`, 'hl');
        if (c.parents.length > 1) print(`Merge: ${c.parents.join(' ')}`);
        print(`Auteur : ${c.author}`);
        print('');
        print(`    ${c.msg}`);
        print('');
      }
    }
    post(`📒 Le registre : ${pl(list.length, 'colis')} fermé${list.length > 1 ? 's' : ''}, du plus récent au plus ancien. Chacun a son numéro de suivi unique.`);
  },

  diff(a) {
    const staged = a.includes('--staged') || a.includes('--cached');
    const st = status();
    const list = staged ? st.staged : st.unstaged;
    if (!list.length) {
      post(staged ? 'Aucune différence entre le carton et le dernier colis fermé.' : "Aucune différence entre l'établi et le carton.");
      return;
    }
    for (const { n, k } of list) {
      print(`diff --git a/${n} b/${n}`, 'hl');
      print(k === 'nouveau' ? '+++ nouvel objet' : k === 'supprimé' ? '--- objet supprimé' : '@@ contenu retouché @@', k === 'supprimé' ? 'err' : 'ok');
    }
    post(staged
      ? 'git diff --staged compare le carton au dernier colis fermé.'
      : "git diff compare l'établi au carton : ce sont les retouches pas encore emballées.");
  },

  restore(a) {
    const staged = a.includes('--staged') || a.includes('-S');
    const files = a.filter(x => !x.startsWith('-'));
    if (!files.length) {
      err('fatal: vous devez spécifier un chemin à restaurer');
      post('Quel objet ? git restore --staged <fichier> le ressort du carton ; git restore <fichier> annule ses retouches.');
      return;
    }
    const H = headTree();
    for (const f of expand(files, union(S.index, S.work, H))) {
      if (staged) {
        if (!(f in S.index) && !(f in H)) { err(`error: le chemin '${f}' ne correspond à aucun fichier connu de git`); continue; }
        if (f in H) S.index[f] = H[f]; else delete S.index[f];
        fx('wiggle', [f]);
        post(`↩️ ${f} ressort du carton et retourne sur l'établi. Il n'est pas perdu, juste plus emballé.`);
      } else {
        if (!(f in S.index)) {
          err(`error: le chemin '${f}' ne correspond à aucun fichier connu de git`);
          post("Git ne peut restaurer que des objets qu'il connaît déjà.");
          continue;
        }
        S.work[f] = S.index[f];
        fx('wiggle', [f]);
        post(`🧽 Retouches de ${f} effacées : l'objet redevient comme dans le carton. (Attention : ça, c'est irréversible !)`);
      }
    }
  },

  reset(a) {
    if (a.includes('--hard')) {
      err('git reset --hard est désactivé dans ce jeu.');
      post('Cette commande détruit du travail sans prévenir : on la garde sous clé pour les apprenti·es 😉');
      return;
    }
    const files = a.filter(x => !x.startsWith('-') && x !== 'HEAD');
    const targets = files.length ? files : status().staged.map(s => s.n);
    if (!targets.length) { post('Le carton est déjà vide.'); return; }
    GIT.restore(['--staged', ...targets]);
  },

  branch(a) {
    const flags = a.filter(x => x.startsWith('-'));
    const names = a.filter(x => !x.startsWith('-'));
    if (flags.some(f => ['-d', '-D', '--delete'].includes(f))) {
      const n = names[0];
      if (!n || !(n in S.branches)) return err(`error: branche '${n ?? ''}' non trouvée.`);
      if (n === S.head) {
        err(`error: impossible de supprimer la branche '${n}' extraite`);
        post('On ne peut pas supprimer la tournée sur laquelle on se trouve !');
        return;
      }
      if (!flags.includes('-D') && S.branches[n] && !isAnc(S.branches[n], headId())) {
        err(`error: la branche '${n}' n'est pas totalement fusionnée.`);
        post('Cette tournée contient des colis qui ne sont nulle part ailleurs. git branch -D pour forcer (ils seraient perdus).');
        return;
      }
      delete S.branches[n];
      print(`Branche ${n} supprimée.`);
      post(`🪧 Le panneau de la tournée « ${n} » est retiré. Les colis déjà fusionnés restent en sécurité.`);
      return;
    }
    if (!names.length) {
      Object.keys(S.branches).sort().forEach(b => print(`${b === S.head ? '* ' : '  '}${b}`, b === S.head ? 'ok' : ''));
      if (flags.includes('-a') || flags.includes('-r')) Object.keys(S.tracking).forEach(t => print(`  remotes/${t}`, 'err'));
      post("📍 L'étoile * indique la tournée sur laquelle vous êtes (HEAD).");
      return;
    }
    const n = names[0];
    if (!validName(n)) return err(`fatal: '${n}' n'est pas un nom de branche valide.`);
    if (n in S.branches) return err(`fatal: une branche nommée '${n}' existe déjà.`);
    if (!headId()) {
      err(`fatal: pas un nom d'objet valide : '${S.head}'.`);
      post("Impossible de créer une tournée sans aucun colis : faites d'abord un premier commit.");
      return;
    }
    S.branches[n] = headId();
    post(`🛣️ Nouvelle tournée « ${n} » créée à partir du colis #${headId()}. Vous êtes toujours sur « ${S.head} » : git switch ${n} pour y aller.`);
  },

  switch(a) { goTo(a, false); },
  checkout(a) { goTo(a, true); },

  merge(a) {
    const n = a.find(x => !x.startsWith('-'));
    if (!n) return err('fatal: précisez la branche à fusionner, ex. git merge express');
    if (n === S.head) { print('Déjà à jour.'); return; }
    const t = n in S.branches ? S.branches[n] : S.tracking[n];
    if (t === undefined) return err(`merge: ${n} - pas une chose que l'on peut fusionner`);
    if (isDirty()) {
      err('error: vos modifications locales seraient écrasées par la fusion.');
      post("Emballez (commit) ou annulez vos retouches avant de réunir les tournées.");
      return;
    }
    doMerge(n, t);
  },

  remote(a) {
    const [op, name, url] = a;
    if (op === 'add') {
      if (!name || !url) return err('usage: git remote add <nom> <adresse>');
      if (S.remote) return err(`error: le dépôt distant ${S.remote.name} existe déjà.`);
      if (!validName(name)) return err(`fatal: '${name}' n'est pas un nom de dépôt distant valide`);
      S.remote = { name, url, branches: {} };
      post(`🏤 Adresse enregistrée : « ${name} » → ${url}. Le camion sait maintenant où livrer (mais rien n'est encore parti !).`);
      return;
    }
    if (op === 'remove' || op === 'rm') {
      if (!S.remote || S.remote.name !== name) return err(`error: pas de dépôt distant de ce nom : '${name ?? ''}'`);
      S.remote = null;
      Object.keys(S.tracking).forEach(k => delete S.tracking[k]);
      post('Adresse du bureau central effacée de votre carnet.');
      return;
    }
    if (!S.remote) { post('Aucun bureau central enregistré. Ajoutez-en un : git remote add origin <adresse>'); return; }
    if (a.includes('-v')) {
      print(`${S.remote.name}\t${S.remote.url} (fetch)`);
      print(`${S.remote.name}\t${S.remote.url} (push)`);
    } else print(S.remote.name);
    post(`« ${S.remote.name} » est le surnom de l'adresse de votre bureau central.`);
  },

  push(a) {
    if (!needRemote()) return;
    const args = a.filter(x => !x.startsWith('-'));
    const rname = args[0] || S.remote.name;
    if (rname !== S.remote.name) {
      err(`fatal: '${rname}' ne semble pas être un dépôt git`);
      post(`Adresse inconnue. Votre central s'appelle « ${S.remote.name} ».`);
      return;
    }
    const b = args[1] || S.head;
    if (!(b in S.branches)) return err(`error: src refspec ${b} ne correspond à aucun élément`);
    const local = S.branches[b];
    if (!local) {
      err(`error: src refspec ${b} ne correspond à aucun élément`);
      post('Aucun colis fermé à envoyer ! Faites au moins un commit.');
      return;
    }
    const rem = S.remote.branches[b];
    if (rem === local) {
      print('Everything up-to-date');
      post('Tout est déjà au bureau central : le camion reste au garage.');
      return;
    }
    if (rem && !isAnc(rem, local)) {
      print(`To ${S.remote.url}`);
      err(` ! [rejected]        ${b} -> ${b} (fetch first)`);
      err(`error: impossible de pousser des références vers '${S.remote.url}'`);
      post("⛔ Refusé ! Le central a reçu des colis que vous n'avez pas encore. Récupérez-les d'abord (git pull), puis renvoyez.");
      return;
    }
    const known = rem ? ancestors(rem) : new Set();
    const sent = [...ancestors(local)].filter(x => !known.has(x) && !remoteSet().has(x));
    S.remote.branches[b] = local;
    S.tracking[`${S.remote.name}/${b}`] = local;
    fx('truck', 'go');
    fx('arriveRemote', sent);
    print(`To ${S.remote.url}`);
    print(rem ? `   ${rem}..${local}  ${b} -> ${b}` : ` * [new branch]      ${b} -> ${b}`, 'ok');
    if (a.includes('-u') || a.includes('--set-upstream')) print(`la branche '${b}' est paramétrée pour suivre '${S.remote.name}/${b}'.`);
    post(`🚚💨 Le camion emporte ${pl(sent.length || 1, 'colis')} vers le bureau central. Vos collègues peuvent maintenant les récupérer !`);
  },

  fetch() {
    if (!needRemote()) return;
    doFetch();
  },

  pull() {
    if (!needRemote()) return;
    if (isDirty()) {
      err('error: vos modifications locales seraient écrasées par la fusion.');
      post('Emballez (commit) ou annulez vos retouches avant de déballer le courrier.');
      return;
    }
    doFetch(true);
    const k = `${S.remote.name}/${S.head}`;
    const t = S.tracking[k];
    if (!t) {
      err(`Il n'y a pas de branche '${S.head}' sur le dépôt distant.`);
      post(`Le central n'a pas encore de tournée « ${S.head} ». Envoyez-la d'abord : git push -u ${S.remote.name} ${S.head}`);
      return;
    }
    doMerge(k, t);
    post('📥 Rappel : git pull = git fetch (relever la boîte aux lettres) + git merge (déballer sur votre tournée).');
  },
};

function needRemote() {
  if (S.remote) return true;
  err("fatal: aucune destination configurée pour l'envoi.");
  post(`Le camion ne sait pas où aller ! Donnez-lui l'adresse du central : git remote add origin ${URL_CENTRAL}`);
  return false;
}

function doFetch(fromPull = false) {
  const before = localSet();
  const lines = [];
  for (const [b, id] of Object.entries(S.remote.branches)) {
    const k = `${S.remote.name}/${b}`;
    if (S.tracking[k] !== id) {
      lines.push(S.tracking[k] ? `   ${S.tracking[k]}..${id}  ${b} -> ${k}` : ` * [nouvelle branche]  ${b} -> ${k}`);
      S.tracking[k] = id;
    }
  }
  if (!lines.length) {
    if (!fromPull) post('📭 Boîte aux lettres relevée : rien de nouveau au bureau central.');
    return;
  }
  print(`Depuis ${S.remote.url}`);
  lines.forEach(l => print(l, 'ok'));
  const got = [...localSet()].filter(x => !before.has(x));
  fx('truck', 'back');
  fx('arriveLocal', got);
  if (!fromPull) post(`📬 Courrier relevé : ${pl(got.length, 'colis')} rangé${got.length > 1 ? 's' : ''} dans votre entrepôt sous l'étiquette ${S.remote.name}/…, mais pas encore déballé${got.length > 1 ? 's' : ''} sur votre tournée. (git merge ou git pull)`);
}

function goTo(a, isCheckout) {
  if (isCheckout && a[0] === '--') return GIT.restore(a.slice(1));
  let create = false, name = null;
  for (const x of a) {
    if (['-c', '-b', '-C', '-B'].includes(x)) create = true;
    else if (!x.startsWith('-')) name = x;
  }
  if (!name) return err('fatal: précisez une branche, ex. git switch main');

  // git checkout lettre.txt = ancienne façon d'annuler des retouches
  if (isCheckout && !create && !(name in S.branches) && (name in S.index)) return GIT.restore([name]);

  if (create) {
    if (!validName(name)) return err(`fatal: '${name}' n'est pas un nom de branche valide.`);
    if (name in S.branches) return err(`fatal: une branche nommée '${name}' existe déjà.`);
    S.branches[name] = headId();
    S.head = name;
    print(`Basculement sur la nouvelle branche '${name}'`);
    post(`🛣️ Nouvelle tournée « ${name} » créée, et vous êtes dessus (📍). Les prochains colis partiront de là, sans toucher à ${Object.keys(S.branches).includes('main') && name !== 'main' ? 'main' : 'l\'ancienne tournée'}.`);
    return;
  }
  if (name === S.head) { print(`Déjà sur '${name}'`); return; }
  if (!(name in S.branches)) {
    const tr = S.remote && S.tracking[`${S.remote.name}/${name}`];
    if (!tr) {
      err(`fatal: référence invalide : ${name}`);
      post(`Aucune tournée « ${name} ». Pour la créer : git switch -c ${name}`);
      return;
    }
    S.branches[name] = tr;
  }
  if (isDirty()) {
    err('error: vos modifications locales seraient écrasées par le basculement.');
    post("Votre carton ou votre établi contient des retouches non emballées. Faites un commit (ou git restore) avant de changer de tournée.");
    return;
  }
  const keep = untrackedMap();
  S.head = name;
  applyTree(treeOf(S.branches[name]), keep);
  print(`Basculement sur la branche '${name}'`);
  post(`🚶 Vous passez sur la tournée « ${name} ». Regardez l'établi : il montre maintenant les objets de cette tournée.`);
}

function doMerge(label, t) {
  const cur = headId();
  if (!t) { print('Rien à fusionner.'); return; }
  if (cur === t || isAnc(t, cur)) {
    print('Déjà à jour.');
    post('Rien de nouveau à déballer : vous avez déjà tous ces colis.');
    return;
  }
  const keep = untrackedMap();
  if (!cur || isAnc(cur, t)) {
    print(`Mise à jour ${cur || '0000000'}..${t}`);
    print('Fast-forward', 'ok');
    S.branches[S.head] = t;
    applyTree(treeOf(t), keep);
    fx('flash', 'repo');
    post(`⏩ Avance rapide : votre tournée « ${S.head} » n'avait rien de neuf, on déplace simplement son panneau jusqu'au dernier colis de « ${label} ».`);
    return;
  }
  const A = ancestors(cur), B = ancestors(t);
  const base = [...A].filter(x => B.has(x)).sort((x, y) => S.commits[y].t - S.commits[x].t)[0];
  const O = treeOf(base), TA = treeOf(cur), TB = treeOf(t);
  const out = {}, conflicts = [];
  for (const n of union(O, TA, TB)) {
    const o = O[n], x = TA[n], y = TB[n];
    let r;
    if (x === y) r = x;
    else if (x === o) r = y;
    else if (y === o) r = x;
    else { conflicts.push(n); r = ++S.seq; }
    if (r !== undefined) out[n] = r;
  }
  const id = makeCommit(`Fusion de '${label}' dans ${S.head}`, out, [cur, t]);
  S.branches[S.head] = id;
  applyTree(out, keep);
  fx('seal', id);
  conflicts.forEach(n => err(`CONFLIT (contenu) : conflit de fusion dans ${n}`));
  print("Merge made by the 'ort' strategy.", 'ok');
  post(`🔀 Les deux tournées sont réunies : un colis de fusion #${id} rassemble le contenu de « ${S.head} » et de « ${label} ».`);
  if (conflicts.length) {
    post(`⚠️ Deux facteurs avaient retouché le même objet (${conflicts.join(', ')}). Ici la Poste a arbitré pour vous ; en vrai, Git vous demande de choisir à la main, puis git add + git commit.`);
  }
}

function refNames(id) {
  const r = [];
  for (const [b, v] of Object.entries(S.branches)) if (v === id) r.push(b === S.head ? `HEAD -> ${b}` : b);
  for (const [k, v] of Object.entries(S.tracking)) if (v === id) r.push(k);
  return r;
}

/* ---------------------------------------------------------
   4. Les missions
   --------------------------------------------------------- */
const hasStaged = n => status().staged.some(s => s.n === n);
const anyCommitHas = re => Object.values(S.commits).some(c => Object.keys(c.tree).some(n => re.test(n)));
const originMain = () => S.remote && S.remote.branches.main;

const BASE = ['git init', 'touch lettre.txt', 'git add lettre.txt', 'git commit -m "Première lettre"'];

const LEVELS = [
  {
    id: 'init', stamp: '🏤', title: 'Ouvrir son bureau de poste',
    story: `<p>Bienvenue, jeune postier·ère ! 👋</p>
      <p>Votre <b>atelier</b> (le dossier de votre projet) n'est pour l'instant qu'un simple local. Pour que la Poste suive vos envois, il faut y ouvrir un <b>bureau de poste</b>, avec son entrepôt secret : le dossier caché <code>.git</code>.</p>`,
    setup: [],
    goals: [{ t: `Ouvrir le bureau avec ${K('git init')}`, ok: () => S.init }],
    hints: ['git init'],
    learn: `${K('git init')} transforme un dossier ordinaire en dépôt Git. On ne le fait qu'<b>une fois</b> par projet.`,
  },
  {
    id: 'untracked', stamp: '✉️', title: "Un objet sur l'établi",
    story: `<p>Fabriquez votre premier objet : une lettre ! ${K('touch lettre.txt')}</p>
      <p>Puis faites l'<b>inventaire</b> avec ${K('git status')}. La Poste repère un objet qu'elle ne connaît pas encore : il est <b>non suivi</b>.</p>`,
    setup: ['git init'],
    goals: [
      { t: `Fabriquer ${K('lettre.txt')}`, ok: () => 'lettre.txt' in S.work },
      { t: `Faire l'inventaire (${K('git status')}) et repérer l'objet non suivi`, ok: () => S.flags.sawUntracked },
    ],
    hints: ['touch lettre.txt', 'git status'],
    learn: `Un fichier <b>non suivi</b> est dans votre dossier, mais Git l'ignore tant que vous ne l'avez pas ajouté.`,
  },
  {
    id: 'add', stamp: '📦', title: "Mettre l'objet dans le carton",
    story: `<p>Un colis se prépare dans un <b>carton ouvert</b> : c'est la <b>zone de préparation</b> (on dit aussi <i>staging</i> ou <i>index</i>).</p>
      <p>Posez-y votre lettre : ${K('git add lettre.txt')}</p>
      <p>Tant que le carton est ouvert, on peut encore ajouter ou retirer des objets. Rien n'est scellé !</p>`,
    setup: ['git init', 'touch lettre.txt'],
    goals: [
      { t: `Mettre ${K('lettre.txt')} dans le carton`, ok: () => hasStaged('lettre.txt') || localCount() > 0 },
      { t: `Revérifier l'inventaire avec ${K('git status')}`, ok: () => S.flags.sawStaged },
    ],
    hints: ['git add lettre.txt', 'git status'],
    learn: `${K('git add')} choisit ce qui fera partie du prochain commit. ${K('git add .')} met tout l'établi dans le carton d'un coup.`,
  },
  {
    id: 'commit', stamp: '🔒', title: 'Fermer et étiqueter le colis',
    story: `<p>Le carton est prêt ? On le <b>ferme</b>, on le <b>scotche</b> et on colle une <b>étiquette</b> qui décrit son contenu. Voilà un <b>commit</b> !</p>
      <p>${K('git commit -m "Ma première lettre"')}</p>
      <p>⚠️ Un colis fermé n'est <b>pas envoyé</b>. Il est rangé dans <i>votre</i> entrepôt : personne d'autre ne le voit encore.</p>`,
    setup: ['git init', 'touch lettre.txt', 'git add lettre.txt'],
    goals: [{ t: 'Fermer le carton avec une étiquette (un commit)', ok: () => localCount() >= 1 }],
    hints: ['git commit -m "Ma première lettre"'],
    learn: `Un commit est une <b>photo figée</b> de vos fichiers, avec un message et un numéro de suivi unique (le <i>hash</i>, ex. <code>a3f9c2e</code>). Il reste <b>local</b>.`,
  },
  {
    id: 'log', stamp: '📒', title: 'Le registre des colis',
    story: `<p>Votre entrepôt contient déjà plusieurs colis. Chacun a un <b>numéro de suivi</b> et une étiquette.</p>
      <p>Consultez le <b>registre</b> : ${K('git log')} (ou la version courte ${K('git log --oneline')}).</p>
      <p>Puis vérifiez que rien ne traîne sur l'établi avec ${K('git status')}.</p>`,
    setup: [...BASE, 'touch photo.jpg', 'git add photo.jpg', 'git commit -m "Ajout d\'une photo de vacances"', 'edit lettre.txt', 'git commit -am "Lettre corrigée"'],
    goals: [
      { t: `Lire le registre avec ${K('git log')}`, ok: () => S.ran.has('log') },
      { t: `Constater que l'établi est propre (${K('git status')})`, ok: () => S.flags.sawClean },
    ],
    hints: ['git log', 'git log --oneline', 'git status'],
    learn: `${K('git log')} liste l'historique, du plus récent au plus ancien. Le numéro de suivi permet de retrouver n'importe quel colis.`,
  },
  {
    id: 'modify', stamp: '✏️', title: 'Retoucher un objet',
    story: `<p>Oh non, une faute dans la lettre ! Modifiez-la : ${K('edit lettre.txt')} (ou cliquez sur ✏️ sur l'établi).</p>
      <p>Git remarque que l'objet n'est plus identique à celui du dernier colis : il est <b>modifié</b>.</p>
      <p>Un colis fermé ne se rouvre pas : pour envoyer la correction, il faut un <b>nouveau colis</b> (add + commit).</p>`,
    setup: [...BASE],
    goals: [
      { t: `Modifier ${K('lettre.txt')}`, ok: () => S.flags.edited },
      { t: 'Emballer la correction dans un nouveau colis', ok: () => localCount() >= 2 },
      { t: "Laisser l'établi propre (rien qui traîne)", ok: () => localCount() >= 2 && !isDirty() && !status().untracked.length },
    ],
    hints: ['edit lettre.txt', 'git status', 'git add lettre.txt', 'git commit -m "Correction de la lettre"'],
    learn: `Chaque modification passe par le même circuit : <b>établi → carton → colis</b>. Les anciens colis restent intacts dans le registre.`,
  },
  {
    id: 'unstage', stamp: '🔑', title: 'Oups, pas ce colis-là !',
    story: `<p>Vous avez tout mis dans le carton avec <code>git add .</code>… y compris <b>motdepasse.txt</b> 🔑 ! Ce fichier ne doit <b>jamais</b> partir.</p>
      <p>Ressortez-le du carton : ${K('git restore --staged motdepasse.txt')} (il reste sur l'établi, il n'est pas effacé).</p>
      <p>Puis fermez le colis avec seulement la lettre corrigée.</p>`,
    setup: [...BASE, 'edit lettre.txt', 'touch motdepasse.txt', 'git add .'],
    goals: [
      { t: `Retirer ${K('motdepasse.txt')} du carton`, ok: () => !hasStaged('motdepasse.txt') && !anyCommitHas(/motdepasse/) },
      { t: 'Fermer un colis avec la lettre corrigée', ok: () => localCount() >= 2 },
      { t: 'Aucun colis ne contient le mot de passe', ok: () => localCount() >= 2 && !anyCommitHas(/motdepasse/) },
    ],
    hints: ['git status', 'git restore --staged motdepasse.txt', 'git commit -m "Lettre corrigée"'],
    learn: `${K('git restore --staged <fichier>')} ressort un objet du carton sans le détruire. (Et pour qu'un fichier ne soit <i>jamais</i> ajouté, on l'écrit dans <code>.gitignore</code>.)`,
  },
  {
    id: 'push', stamp: '🚚', title: 'Expédier au bureau central',
    story: `<p>Vos colis dorment dans votre entrepôt. Pour les partager, il faut les envoyer au <b>bureau de poste central</b> : le <b>dépôt distant</b> (GitHub, GitLab…).</p>
      <p>1. Enregistrez son adresse sous le surnom <b>origin</b> :<br>${K(`git remote add origin ${URL_CENTRAL}`)}</p>
      <p>2. Appelez le camion : ${K('git push -u origin main')}</p>`,
    setup: [...BASE, 'touch photo.jpg', 'git add .', 'git commit -m "Ajout d\'une photo"'],
    goals: [
      { t: "Enregistrer l'adresse du bureau central", ok: () => !!S.remote },
      { t: `Envoyer vos colis avec ${K('git push')}`, ok: () => !!S.branches.main && originMain() === S.branches.main },
    ],
    hints: [`git remote add origin ${URL_CENTRAL}`, 'git push -u origin main'],
    learn: `${K('git push')} copie vos commits vers le dépôt distant. Avant ça, ils n'existent que sur votre ordinateur !`,
  },
  {
    id: 'pull', stamp: '📬', title: 'Du courrier pour vous !',
    story: `<p>Camille, votre collègue, a envoyé un colis au bureau central : une facture 🧾. Mais Git ne consulte <b>jamais</b> le central tout seul : votre entrepôt n'en sait rien (essayez ${K('git status')}).</p>
      <p>• ${K('git fetch')} = relever la boîte aux lettres (le colis arrive, étiqueté <code>origin/main</code>)<br>
      • ${K('git pull')} = relever <b>et</b> déballer sur votre tournée (fetch + merge)</p>`,
    setup: [...BASE, `git remote add origin ${URL_CENTRAL}`, 'git push -u origin main', '@colleague facture.pdf "Ajout de la facture"'],
    goals: [
      { t: 'Relever le courrier du bureau central', ok: () => S.remote && S.tracking[`${S.remote.name}/main`] === originMain() },
      { t: `Avoir ${K('facture.pdf')} sur votre établi`, ok: () => 'facture.pdf' in S.work },
    ],
    hints: ['git fetch', 'git status', 'git pull'],
    learn: `${K('git pull')} = ${K('git fetch')} + ${K('git merge')}. Pensez à faire un pull avant de travailler pour partir de la dernière version.`,
  },
  {
    id: 'branch', stamp: '🛣️', title: 'Une nouvelle tournée',
    story: `<p>Une <b>branche</b>, c'est une <b>tournée de livraison</b> parallèle : on prépare des colis spéciaux sans déranger la tournée principale <code>main</code>.</p>
      <p>1. Créez la tournée et partez dessus : ${K('git switch -c express')}</p>
      <p>2. Fabriquez un objet, mettez-le dans le carton et fermez le colis sur cette tournée.</p>
      <p>Le panneau 📍 (<b>HEAD</b>) indique où vous êtes.</p>`,
    setup: [...BASE],
    goals: [
      { t: 'Être sur une autre tournée que <code>main</code>', ok: () => S.head !== 'main' },
      {
        t: 'Fermer un colis sur cette tournée',
        ok: () => Object.entries(S.branches).some(([b, id]) => b !== 'main' && id && !isAnc(id, S.branches.main)),
      },
    ],
    hints: ['git switch -c express', 'touch colis-express.txt', 'git add colis-express.txt', 'git commit -m "Colis express"', 'git log --oneline --all'],
    learn: `${K('git switch -c <nom>')} crée une branche et s'y place. Les commits faits dessus n'apparaissent pas sur <code>main</code>… jusqu'à la fusion.`,
  },
  {
    id: 'merge', stamp: '🔀', title: 'Réunir les tournées',
    story: `<p>La tournée <code>express</code> a un colis 🖼️ <b>carte-postale.png</b> qui n'est pas sur <code>main</code>, et <code>main</code> a reçu une lettre signée entre-temps.</p>
      <p>1. Revenez sur la tournée principale : ${K('git switch main')} (regardez l'établi changer !)</p>
      <p>2. Fusionnez : ${K('git merge express')}</p>`,
    setup: [...BASE, 'git switch -c express', 'touch carte-postale.png', 'git add .', 'git commit -m "Ajout d\'une carte postale"',
      'git switch main', 'edit lettre.txt', 'git commit -am "Lettre signée"', 'git switch express'],
    goals: [
      { t: 'Revenir sur <code>main</code>', ok: () => S.head === 'main' },
      { t: `Fusionner ${K('express')} dans <code>main</code>`, ok: () => isAnc(S.branches.express, S.branches.main) },
    ],
    hints: ['git switch main', 'git merge express', 'git log --oneline'],
    learn: `${K('git merge <branche>')} ramène les colis d'une autre tournée dans celle où vous êtes. Si les deux ont avancé, Git crée un <b>colis de fusion</b> 🔀.`,
  },
  {
    id: 'final', stamp: '👑', title: 'Chef·fe de poste',
    story: `<p>Dernière épreuve, sans filet ! Livrez un 🎁 <b>cadeau.txt</b> au bureau central en passant par une tournée spéciale :</p>
      <p>créer une branche → fabriquer <code>cadeau.txt</code> → add → commit → revenir sur <code>main</code> → merge → push.</p>`,
    setup: [...BASE, `git remote add origin ${URL_CENTRAL}`, 'git push -u origin main'],
    goals: [
      { t: 'Créer une tournée spéciale', ok: () => Object.keys(S.branches).length > 1 },
      { t: `Fermer un colis contenant ${K('cadeau.txt')} sur cette tournée`, ok: () => Object.values(S.commits).some(c => c.branch !== 'main' && 'cadeau.txt' in c.tree) },
      { t: 'Le fusionner dans <code>main</code>', ok: () => 'cadeau.txt' in treeOf(S.branches.main) },
      { t: 'Expédier <code>main</code> au bureau central', ok: () => 'cadeau.txt' in treeOf(originMain()) },
    ],
    hints: ['git switch -c cadeau', 'touch cadeau.txt', 'git add cadeau.txt', 'git commit -m "Un cadeau"', 'git switch main', 'git merge cadeau', 'git push'],
    learn: `Bravo, c'est exactement le quotidien d'un·e développeur·se : branche → commits → fusion → push. 🎉`,
  },
];

/* ---------------------------------------------------------
   5. Progression
   --------------------------------------------------------- */
let levelIdx = 0;
let sandbox = false;
let levelDone = false;
let hintsOpen = false;
let progress = { done: [], level: 0, welcomed: false };

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (p && Array.isArray(p.done)) progress = { ...progress, ...p };
  } catch { /* stockage indisponible : on joue sans sauvegarde */ }
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch { /* idem */ }
}
const isUnlocked = i => i === 0 || progress.done.includes(LEVELS[i - 1].id) || progress.done.includes(LEVELS[i].id);

function startLevel(i) {
  sandbox = false;
  levelIdx = Math.max(0, Math.min(i, LEVELS.length - 1));
  progress.level = levelIdx;
  save();
  const L = LEVELS[levelIdx];
  S = freshState();
  quiet = true;
  L.setup.forEach(run);
  quiet = false;
  S.ran = new Set();
  S.flags = {};
  S.fx = {};
  levelDone = false;
  hintsOpen = false;
  outEl.innerHTML = '';
  print(`══ Mission ${levelIdx + 1} : ${L.title} ══`, 'title');
  print('Lisez la mission à gauche, puis tapez vos commandes ici. (help pour la liste)', 'dim');
  render();
  $('#term-in').focus({ preventScroll: true });
}

function startSandbox() {
  sandbox = true;
  S = freshState();
  outEl.innerHTML = '';
  print('══ Bac à sable ══', 'title');
  print('Aucun objectif : expérimentez librement ! Pour avoir un bureau central : git remote add origin <adresse>', 'dim');
  render();
  $('#term-in').focus({ preventScroll: true });
}

function checkLevel() {
  if (sandbox || levelDone) return;
  const L = LEVELS[levelIdx];
  if (!L.goals.every(g => safe(g.ok))) return;
  levelDone = true;
  if (!progress.done.includes(L.id)) progress.done.push(L.id);
  save();
  updateStampCount();
  setTimeout(() => showWin(L), 900);
}
const safe = f => { try { return !!f(); } catch { return false; } };

/* ---------------------------------------------------------
   6. Affichage
   --------------------------------------------------------- */
const LANES = ['#d64545', '#2f9e61', '#8e44ad', '#e67e22', '#0e9aa7', '#c2185b'];
function laneColor(name) {
  if (name === 'main') return '#1c3f94';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LANES[h % LANES.length];
}

function icon(n) {
  if (/mot.?de.?passe|secret|\.env/i.test(n)) return '🔑';
  if (/cadeau/i.test(n)) return '🎁';
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(n)) return '🖼️';
  if (/\.pdf$/i.test(n)) return '🧾';
  if (/\.(js|html|css|py|ts|php|java|c)$/i.test(n)) return '💾';
  if (/lettre|\.txt$|\.md$/i.test(n)) return '✉️';
  return '📄';
}

function render() {
  $('#prompt').textContent = promptText();
  renderWork();
  renderBox();
  renderRepo();
  renderRemote();
  renderMission();
  playFx();
}

function renderWork() {
  const el = $('#work-items');
  const H = headTree(), I = S.index, W = S.work;
  const names = union(W, I);
  if (!names.length) {
    el.innerHTML = `<p class="empty">L'établi est vide.<br>Fabriquez un objet : ${K('touch lettre.txt')}</p>`;
    return;
  }
  const wig = S.fx.wiggle || [];
  el.innerHTML = names.map(n => {
    let st, label;
    if (!S.init || !(n in I)) [st, label] = ['untracked', 'non suivi'];
    else if (!(n in W)) [st, label] = ['deleted', 'supprimé'];
    else if (W[n] !== I[n]) [st, label] = ['modified', 'modifié'];
    else if (I[n] !== H[n]) [st, label] = ['staged', 'au carton'];
    else [st, label] = ['clean', '✓ à jour'];
    return `<div class="item ${st}${wig.includes(n) ? ' wiggle' : ''}" data-add="${esc(n)}" title="Cliquer pour préparer « git add ${esc(n)} »">
      <span class="ico">${icon(n)}</span><span class="nm">${esc(n)}</span><span class="tag">${label}</span>
      ${n in W ? `<button class="edit" data-edit="${esc(n)}" title="Modifier ${esc(n)}" aria-label="Modifier ${esc(n)}">✏️</button>` : ''}
    </div>`;
  }).join('');
}

function renderBox() {
  const el = $('#box-items');
  $('#z-box').classList.toggle('locked', !S.init);
  if (!S.init) {
    el.innerHTML = `<p class="empty">🚧 Pas encore de bureau de poste.<br>${K('git init')}</p>`;
    $('#btn-seal').disabled = true;
    return;
  }
  const st = status().staged;
  const drop = S.fx.drop || [];
  el.innerHTML = st.length
    ? st.map(({ n, k }) => `<div class="item staged${drop.includes(n) ? ' drop' : ''}" title="git restore --staged ${esc(n)} pour le ressortir">
        <span class="ico">${icon(n)}</span><span class="nm">${esc(n)}</span><span class="tag">${k}</span></div>`).join('')
    : `<p class="empty">Le carton est vide.<br>${K('git add .')}</p>`;
  $('#btn-seal').disabled = !st.length;
}

function parcelHTML(c, { anim = '', refs = '', badge = '' }) {
  const files = Object.keys(c.tree).map(icon).join('');
  return `<div class="parcel ${anim}" style="--lane:${laneColor(c.branch)}" title="Colis #${c.id} — tournée ${esc(c.branch)}">
    <div class="tape"></div>
    <div class="label">
      <div class="row"><span class="hash">#${c.id}</span>${c.parents.length > 1 ? '<span class="merge">🔀 fusion</span>' : ''}</div>
      <div class="msg">${esc(c.msg)}</div>
      <div class="meta">${c.author !== 'Vous' ? '👤 ' + esc(c.author) + ' · ' : ''}${files || '∅'}</div>
      <div class="refs">${refs}${badge}</div>
    </div>
  </div>`;
}

function renderRepo() {
  const el = $('#repo-items');
  $('#z-repo').classList.toggle('locked', !S.init);
  if (!S.init) {
    $('#repo-branch').innerHTML = '';
    el.innerHTML = `<p class="empty">🚧 L'entrepôt n'existe pas encore.</p>`;
    return;
  }
  $('#repo-branch').innerHTML = `📍 Vous êtes sur la tournée <b>${esc(S.head)}</b>`;
  const rs = remoteSet();
  const list = [...localSet()].map(id => S.commits[id]).sort((a, b) => b.t - a.t);
  if (!list.length) {
    el.innerHTML = `<p class="empty">Aucun colis fermé pour l'instant.<br>${K('git commit -m "…"')}</p>`;
    return;
  }
  const arrive = S.fx.arriveLocal || [];
  el.innerHTML = list.map(c => {
    let refs = '';
    for (const [b, v] of Object.entries(S.branches)) {
      if (v === c.id) refs += `<span class="ref br" style="--c:${laneColor(b)}">${b === S.head ? '📍 ' : ''}${esc(b)}</span>`;
    }
    for (const [k, v] of Object.entries(S.tracking)) if (v === c.id) refs += `<span class="ref tr">${esc(k)}</span>`;
    const badge = !S.remote ? '' : rs.has(c.id) ? '<span class="ship ok">✅ au central</span>' : '<span class="ship no">⏳ pas expédié</span>';
    const anim = S.fx.seal === c.id ? 'seal' : arrive.includes(c.id) ? 'arrive' : '';
    return parcelHTML(c, { anim, refs, badge });
  }).join('');
  if (S.fx.flash === 'repo') {
    const z = $('#z-repo');
    z.classList.remove('flash'); void z.offsetWidth; z.classList.add('flash');
  }
}

function renderRemote() {
  const el = $('#remote-items');
  if (!S.remote) {
    $('#remote-sub').textContent = 'dépôt distant';
    el.innerHTML = `<p class="empty">Aucun bureau central enregistré.<br><br>Le camion ne sait pas où livrer : <code>git remote add origin &lt;adresse&gt;</code></p>`;
    return;
  }
  $('#remote-sub').textContent = `« ${S.remote.name} » · ${S.remote.url.replace(/^https?:\/\//, '')}`;
  const ls = localSet();
  const list = [...remoteSet()].map(id => S.commits[id]).sort((a, b) => b.t - a.t);
  if (!list.length) {
    el.innerHTML = `<p class="empty">Le bureau central attend vos colis.<br>${K('git push -u origin main')}</p>`;
    return;
  }
  const arrive = S.fx.arriveRemote || [];
  el.innerHTML = list.map(c => {
    let refs = '';
    for (const [b, v] of Object.entries(S.remote.branches)) if (v === c.id) refs += `<span class="ref br" style="--c:${laneColor(b)}">${esc(b)}</span>`;
    const badge = ls.has(c.id) ? '' : '<span class="ship new">🆕 pas encore chez vous</span>';
    return parcelHTML(c, { anim: arrive.includes(c.id) ? 'arrive' : '', refs, badge });
  }).join('');
}

function renderMission() {
  const el = $('#mission');
  if (sandbox) {
    el.innerHTML = `
      <div class="m-top"><span class="m-lvl">Mode libre</span><span style="font-size:30px">🧪</span></div>
      <h2>Bac à sable</h2>
      <div class="story">
        <p>Ici, pas d'objectif : testez tout ce que vous voulez, cassez, recommencez !</p>
        <p>Quelques idées :</p>
        <p>${K('git init')} ${K('touch index.html')} ${K('git add .')} ${K('git commit -m "Début"')} ${K('git switch -c essai')} ${K(`git remote add origin ${URL_CENTRAL}`)} ${K('git push -u origin main')} ${K('git log --oneline --all')}</p>
      </div>
      <div class="m-actions">
        <button class="btn" data-act="sandbox">↺ Tout effacer</button>
        <button class="btn primary" data-act="back">◀ Retour aux missions</button>
      </div>`;
    return;
  }
  const L = LEVELS[levelIdx];
  const done = progress.done.includes(L.id);
  const goals = L.goals.map(g => {
    const ok = safe(g.ok);
    return `<li class="${ok ? 'done' : ''}"><span class="ck">${ok ? '✅' : '⬜'}</span><span class="gt">${g.t}</span></li>`;
  }).join('');
  el.innerHTML = `
    <div class="m-top">
      <span class="m-lvl">Mission ${levelIdx + 1} / ${LEVELS.length}</span>
      <span style="font-size:30px" title="${done ? 'Timbre obtenu' : 'Timbre à gagner'}">${done ? L.stamp : '🔒'}</span>
    </div>
    <h2>${L.title}</h2>
    <div class="story">${L.story}</div>
    <h4>Objectifs</h4>
    <ul class="goals">${goals}</ul>
    ${done ? `<div class="learn">💡 ${L.learn}</div>` : ''}
    <div class="m-actions">
      <button class="btn ghost" data-act="hint">${hintsOpen ? '🙈 Cacher la solution' : '💡 Voir la solution'}</button>
      <button class="btn ghost" data-act="reset">↺ Recommencer</button>
    </div>
    <div class="hints" ${hintsOpen ? '' : 'hidden'}>
      ${L.hints.map(h => `<button class="chip" data-fill="${esc(h)}">${esc(h)}</button>`).join('')}
    </div>
    <div class="m-nav">
      <button class="btn" data-act="prev" ${levelIdx === 0 ? 'disabled' : ''}>◀ Précédente</button>
      <button class="btn ${done ? 'primary' : ''}" data-act="next" ${levelIdx < LEVELS.length - 1 && isUnlocked(levelIdx + 1) ? '' : 'disabled'}>Suivante ▶</button>
    </div>`;
}

function playFx() {
  const f = S.fx;
  S.fx = {};
  if (f.truck) {
    const t = $('#truck');
    t.className = 'truck';
    void t.offsetWidth;
    t.className = 'truck ' + f.truck;
  }
}

function updateStampCount() {
  $('#stamp-count').textContent = `${progress.done.length}/${LEVELS.length}`;
}

/* ---------------------------------------------------------
   7. Boîtes de dialogue
   --------------------------------------------------------- */
const dlg = $('#dlg');
function openDialog(html) {
  $('#dlg-body').innerHTML = html;
  if (!dlg.open) dlg.showModal();
}

function stampHTML(L, cls = '') {
  return `<div class="face"><span class="e">${L.stamp}</span><span class="t">${esc(L.title)}</span><span class="v">git · ${L.id}</span></div>`;
}

function showWin(L) {
  confetti();
  const last = levelIdx === LEVELS.length - 1;
  openDialog(`
    <div class="center">
      <h2>${last ? '👑 Vous êtes Chef·fe de poste !' : '📬 Mission accomplie !'}</h2>
      <div class="stamp big-stamp">${stampHTML(L)}</div><br>
      <span class="postmark">LIVRÉ · ${new Date().toLocaleDateString('fr-FR')}</span>
    </div>
    <div class="learn" style="margin-top:16px">💡 ${L.learn}</div>
    ${last ? `<p class="center">Vous avez récolté les ${LEVELS.length} timbres. Git n'a plus de secret pour vous… enfin presque 😉</p>` : ''}
    <div class="dlg-actions">
      <button class="btn" data-act="close">Rester ici</button>
      ${last
        ? '<button class="btn primary" data-act="stamps">🏅 Voir mon carnet</button>'
        : '<button class="btn primary" data-act="next">Mission suivante ▶</button>'}
    </div>`);
}

function showStamps() {
  openDialog(`
    <h2>🏅 Carnet de timbres</h2>
    <p>Chaque mission réussie vous rapporte un timbre. Cliquez sur une mission débloquée pour la (re)jouer.</p>
    <div class="stamps">
      ${LEVELS.map((L, i) => {
        const got = progress.done.includes(L.id);
        const open = isUnlocked(i);
        return `<button class="stamp ${got ? '' : open ? 'open' : 'locked'}" data-level="${i}" ${open ? '' : 'disabled'} title="${open ? 'Jouer' : 'Verrouillée'}">
          ${got ? stampHTML(L) : `<div class="face"><span class="e">${open ? '✉️' : '🔒'}</span><span class="t">${i + 1}. ${esc(L.title)}</span></div>`}
        </button>`;
      }).join('')}
    </div>
    <div class="dlg-actions">
      <button class="btn ghost" data-act="wipe">Effacer ma progression</button>
      <button class="btn primary" data-act="close">Fermer</button>
    </div>`);
}

const DICO = [
  ['Dossier de travail', "🛠️ L'établi, là où l'on fabrique et retouche les objets"],
  ['git init', '🏤 Ouvrir son bureau de poste (avec un entrepôt caché .git)'],
  ['Fichier non suivi', '❓ Un objet inconnu de la Poste, qui traîne sur l\'établi'],
  ['git add', '📦 Poser un objet dans le carton ouvert'],
  ['Index / staging', '📦 Le carton ouvert, encore en préparation'],
  ['git commit', '🔒 Fermer, scotcher et étiqueter le carton. Rangé dans VOTRE entrepôt, pas envoyé !'],
  ['Message de commit', "🏷️ L'étiquette qui décrit le contenu du colis"],
  ['Hash (ex. a3f9c2e)', '🔢 Le numéro de suivi unique du colis'],
  ['git status', "📋 L'inventaire : qu'y a-t-il sur l'établi, dans le carton ?"],
  ['git log', '📒 Le registre de tous les colis fermés'],
  ['git diff', '🔍 Comparer l\'objet retouché avec la version emballée'],
  ['git restore --staged', '↩️ Ressortir un objet du carton'],
  ['git restore', '🧽 Effacer les retouches d\'un objet'],
  ['Dépôt distant / origin', '🏤 Le bureau de poste central (GitHub, GitLab…)'],
  ['git push', '🚚 Le camion part livrer vos colis au central'],
  ['git fetch', '📬 Relever la boîte aux lettres, sans déballer'],
  ['git pull', '📥 Relever la boîte aux lettres ET déballer (fetch + merge)'],
  ['git clone', '🏗️ Recopier chez soi tout un bureau central existant'],
  ['Branche', '🛣️ Une tournée de livraison parallèle'],
  ['HEAD', '📍 Le panneau « Vous êtes ici »'],
  ['git switch', '🚶 Changer de tournée'],
  ['git merge', '🔀 Réunir deux tournées'],
  ['Conflit', '⚔️ Deux facteurs ont retouché le même objet différemment'],
  ['.gitignore', '🚫 La liste des objets interdits d\'envoi'],
];

function showDico() {
  openDialog(`
    <h2>📖 Dictionnaire Git ↔ Poste</h2>
    <table class="dico">
      <thead><tr><th>Git</th><th>Au bureau de poste</th></tr></thead>
      <tbody>${DICO.map(([g, p]) => `<tr><td><code>${esc(g)}</code></td><td>${esc(p)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="dlg-actions"><button class="btn primary" data-act="close">Fermer</button></div>`);
}

function showWelcome() {
  openDialog(`
    <h2>📮 Bienvenue au guichet !</h2>
    <p>Git, c'est un peu comme envoyer des colis. Suivez le trajet d'un objet :</p>
    <div class="welcome-steps">
      <div><b>🛠️</b>L'<b style="display:inline;font-size:inherit">établi</b><br>vos fichiers</div>
      <div><b>📦</b><code>git add</code><br>dans le carton</div>
      <div><b>🔒</b><code>git commit</code><br>colis fermé… pas envoyé !</div>
      <div><b>🚚</b><code>git push</code><br>vers le central</div>
    </div>
    <p>Chaque mission vous rapporte un <b>timbre</b>. Tapez les commandes dans le terminal en bas, ou cliquez sur les <code>commandes jaunes</code> pour les pré-remplir.</p>
    <div class="dlg-actions">
      <button class="btn" data-act="dico">📖 Dictionnaire</button>
      <button class="btn primary" data-act="close">C'est parti ! ▶</button>
    </div>`);
}

function confetti() {
  const box = $('#confetti');
  const bits = ['📦', '✉️', '📮', '🎉', '⭐', '🏷️', '🚚'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = bits[i % bits.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
    s.style.animationDelay = Math.random() * .5 + 's';
    box.appendChild(s);
    setTimeout(() => s.remove(), 4200);
  }
}

/* ---------------------------------------------------------
   8. Interactions
   --------------------------------------------------------- */
const input = $('#term-in');
const hist = [];
let hIdx = 0;

function exec(line) {
  run(line);
  render();
  outEl.scrollTop = outEl.scrollHeight;
  checkLevel();
}

function fill(text, caretBack = 0) {
  input.value = text;
  input.focus();
  const p = text.length - caretBack;
  input.setSelectionRange(p, p);
}

$('#term-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = input.value;
  input.value = '';
  if (v.trim()) { hist.push(v); hIdx = hist.length; }
  exec(v);
});

input.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' && hIdx > 0) {
    e.preventDefault(); fill(hist[--hIdx]);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    hIdx = Math.min(hist.length, hIdx + 1);
    fill(hist[hIdx] ?? '');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    complete();
  }
});

function complete() {
  const v = input.value;
  const parts = v.split(' ');
  const last = parts.pop();
  const pool = parts.length === 0
    ? Object.keys(CMDS).filter(c => !c.startsWith('@'))
    : parts[0] === 'git' && parts.length === 1
      ? Object.keys(GIT)
      : [...union(S.work, S.index), ...Object.keys(S.branches), ...Object.keys(S.tracking)];
  const hits = [...new Set(pool)].filter(x => x.startsWith(last));
  if (hits.length === 1) fill([...parts, hits[0]].join(' ') + ' ');
  else if (hits.length > 1) {
    print(hits.join('   '), 'dim');
    outEl.scrollTop = outEl.scrollHeight;
  }
}

// Clic sur une commande jaune ou une puce : pré-remplit le terminal
document.addEventListener('click', e => {
  const c = e.target.closest('code.cmd, .chip');
  if (c) {
    if (dlg.open && dlg.contains(c)) dlg.close();
    fill(c.dataset.fill || c.textContent);
  }
});

$('#work-items').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) { exec(`edit ${ed.dataset.edit}`); return; }
  const it = e.target.closest('[data-add]');
  if (it && !e.target.closest('code')) fill(`git add ${it.dataset.add}`);
});
$('#btn-new').addEventListener('click', () => fill('touch '));
$('#btn-seal').addEventListener('click', () => fill('git commit -m ""', 1));

$('#btn-stamps').addEventListener('click', showStamps);
$('#btn-dico').addEventListener('click', showDico);
$('#btn-sandbox').addEventListener('click', startSandbox);

// Boutons d'action (panneau mission + dialogues)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act], [data-level]');
  if (!b || b.disabled) return;
  if (b.dataset.level !== undefined) { dlg.close(); startLevel(+b.dataset.level); return; }
  switch (b.dataset.act) {
    case 'hint': hintsOpen = !hintsOpen; renderMission(); break;
    case 'reset': startLevel(levelIdx); break;
    case 'prev': startLevel(levelIdx - 1); break;
    case 'next': dlg.close(); startLevel(levelIdx + 1); break;
    case 'back': startLevel(progress.level); break;
    case 'sandbox': startSandbox(); break;
    case 'close': dlg.close(); input.focus(); break;
    case 'dico': showDico(); break;
    case 'stamps': showStamps(); break;
    case 'wipe':
      if (confirm('Effacer tous vos timbres et recommencer depuis la mission 1 ?')) {
        progress = { done: [], level: 0, welcomed: true };
        save(); updateStampCount(); dlg.close(); startLevel(0);
      }
      break;
  }
});
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

/* ---------------------------------------------------------
   9. C'est parti !
   --------------------------------------------------------- */
load();
updateStampCount();
startLevel(isUnlocked(progress.level) ? progress.level : 0);
if (!progress.welcomed) {
  progress.welcomed = true;
  save();
  showWelcome();
}
