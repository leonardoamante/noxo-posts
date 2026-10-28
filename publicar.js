// Publica no Instagram e no Facebook da NOXO o próximo post vencido da fila.
//
// Uso:
//   node publicar.js                 -> publica o post mais antigo com horário já vencido
//   node publicar.js <slot>          -> publica um post específico (ex.: 2026-11-03-0800)
//   node publicar.js --teste [slot]  -> só valida (monta o post na Meta sem publicar)
//
// Estrutura de cada post: fila/<AAAA-MM-DD-HHMM>/ com 01.jpg, 02.jpg..., legenda.txt
// e, opcionalmente, story.jpg (publicado nos Stories logo depois do post).
// Pasta com reel.mp4 + legenda.txt é publicada como Reel (Instagram e Facebook).
// O horário do nome da pasta é o de Brasília. Publica no máximo um post por execução.
//
// Variáveis de ambiente (segredos do GitHub):
//   META_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID

const fs = require('fs');
const path = require('path');

const GRAPH = 'https://graph.facebook.com';
const FILA = path.join(__dirname, 'fila');
const PUBLICADOS = path.join(__dirname, 'publicados');
const REPO = process.env.GITHUB_REPOSITORY || 'leonardoamante/noxo-posts';
const REF = process.env.REF || process.env.GITHUB_SHA || 'main';

const env = (nome) => {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} não definida`);
  return valor;
};

// O workflow dispara alguns minutos antes do horário cheio (11:50 para o post das 12:00),
// então um post conta como vencido até 15 minutos antes do horário dele.
const TOLERANCIA_MIN = 15;

function agoraBrasilia(adiantarMin = 0) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(Date.now() + adiantarMin * 60000)).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

function escolherSlot(pedido) {
  const slots = fs.existsSync(FILA)
    ? fs.readdirSync(FILA).filter((s) => /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(s)).sort()
    : [];
  if (pedido) {
    if (!slots.includes(pedido)) throw new Error(`Post ${pedido} não está na fila`);
    return pedido;
  }
  const limite = agoraBrasilia(TOLERANCIA_MIN);
  return slots.find((s) => s <= limite) || null;
}

async function graph(metodo, caminho, token, params = {}) {
  const url = new URL(`${GRAPH}/${caminho}`);
  const corpo = new URLSearchParams({ ...params, access_token: token });
  const resp =
    metodo === 'GET'
      ? await fetch(`${url}?${corpo}`)
      : await fetch(url, { method: 'POST', body: corpo });
  const json = await resp.json();
  if (json.error) throw new Error(`${caminho}: ${json.error.message}`);
  return json;
}

async function aguardarContainer(id, token, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    const { status_code } = await graph('GET', id, token, { fields: 'status_code' });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Container ${id}: ${status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Container ${id} não ficou pronto em ${tentativas * 5}s`);
}

async function instagram(urls, legenda, teste) {
  const token = env('META_ACCESS_TOKEN');
  const ig = env('META_IG_USER_ID');

  let container;
  if (urls.length === 1) {
    container = (await graph('POST', `${ig}/media`, token, { image_url: urls[0], caption: legenda })).id;
  } else {
    const filhos = [];
    for (const url of urls) {
      filhos.push((await graph('POST', `${ig}/media`, token, { image_url: url, is_carousel_item: 'true' })).id);
    }
    for (const filho of filhos) await aguardarContainer(filho, token);
    container = (await graph('POST', `${ig}/media`, token, {
      media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda,
    })).id;
  }
  await aguardarContainer(container, token);
  if (teste) return { teste: 'ok' };

  const { id } = await graph('POST', `${ig}/media_publish`, token, { creation_id: container });
  const { permalink } = await graph('GET', id, token, { fields: 'permalink' });
  return { id, permalink };
}

async function facebook(urls, legenda, teste) {
  const token = env('META_PAGE_ACCESS_TOKEN');
  const pagina = env('META_PAGE_ID');
  if (teste) {
    await graph('GET', pagina, token, { fields: 'name' });
    return { teste: 'ok' };
  }

  if (urls.length === 1) {
    const { post_id } = await graph('POST', `${pagina}/photos`, token, { url: urls[0], message: legenda });
    return { id: post_id, permalink: `https://www.facebook.com/${post_id}` };
  }
  const fotos = [];
  for (const url of urls) {
    fotos.push((await graph('POST', `${pagina}/photos`, token, { url, published: 'false' })).id);
  }
  const params = { message: legenda };
  fotos.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  const { id } = await graph('POST', `${pagina}/feed`, token, params);
  return { id, permalink: `https://www.facebook.com/${id}` };
}

async function reelInstagram([url], legenda, teste) {
  const token = env('META_ACCESS_TOKEN');
  const ig = env('META_IG_USER_ID');
  // share_to_feed=false: o Reel vai para a aba Reels e não quebra a grade planejada do feed.
  const { id: container } = await graph('POST', `${ig}/media`, token, {
    media_type: 'REELS', video_url: url, caption: legenda, share_to_feed: 'false',
  });
  await aguardarContainer(container, token, 72);
  if (teste) return { teste: 'ok' };
  const { id } = await graph('POST', `${ig}/media_publish`, token, { creation_id: container });
  const { permalink } = await graph('GET', id, token, { fields: 'permalink' });
  return { id, permalink };
}

async function reelFacebook([url], legenda, teste) {
  const token = env('META_PAGE_ACCESS_TOKEN');
  const pagina = env('META_PAGE_ID');
  if (teste) return { teste: 'ok' };
  const { video_id, upload_url } = await graph('POST', `${pagina}/video_reels`, token, { upload_phase: 'start' });
  const envio = await (await fetch(upload_url, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_url: url },
  })).json();
  if (!envio.success) throw new Error(`upload do Reel: ${JSON.stringify(envio)}`);
  await graph('POST', `${pagina}/video_reels`, token, {
    upload_phase: 'finish', video_id, video_state: 'PUBLISHED', description: legenda,
  });
  return { id: video_id, permalink: `https://www.facebook.com/reel/${video_id}` };
}

async function storyInstagram(url, teste) {
  const token = env('META_ACCESS_TOKEN');
  const ig = env('META_IG_USER_ID');
  const { id: container } = await graph('POST', `${ig}/media`, token, { image_url: url, media_type: 'STORIES' });
  await aguardarContainer(container, token);
  if (teste) return { teste: 'ok' };
  const { id } = await graph('POST', `${ig}/media_publish`, token, { creation_id: container });
  return { id };
}

async function storyFacebook(url, teste) {
  const token = env('META_PAGE_ACCESS_TOKEN');
  const pagina = env('META_PAGE_ID');
  if (teste) return { teste: 'ok' };
  const { id: foto } = await graph('POST', `${pagina}/photos`, token, { url, published: 'false' });
  const { post_id } = await graph('POST', `${pagina}/photo_stories`, token, { photo_id: foto });
  return { id: post_id };
}

async function main() {
  const args = process.argv.slice(2);
  const teste = args.includes('--teste');
  const slot = escolherSlot(args.find((a) => !a.startsWith('--')));
  if (!slot) {
    console.log(`Nenhum post vencido na fila (agora: ${agoraBrasilia()}).`);
    return;
  }

  const pasta = path.join(FILA, slot);
  const url = (f) => `https://raw.githubusercontent.com/${REPO}/${REF}/fila/${slot}/${f}`;
  const legenda = fs.readFileSync(path.join(pasta, 'legenda.txt'), 'utf8').trim();
  const ehReel = fs.existsSync(path.join(pasta, 'reel.mp4'));
  const temStory = fs.existsSync(path.join(pasta, 'story.jpg'));

  let urls, publicarInstagram, publicarFacebook;
  if (ehReel) {
    urls = [url('reel.mp4')];
    [publicarInstagram, publicarFacebook] = [reelInstagram, reelFacebook];
    console.log(`${teste ? '[TESTE] ' : ''}Reel ${slot}`);
  } else {
    const imagens = fs.readdirSync(pasta).filter((f) => /^\d+\.jpe?g$/i.test(f)).sort();
    if (imagens.length < 1 || imagens.length > 10) throw new Error(`${slot}: precisa de 1 a 10 imagens .jpg`);
    urls = imagens.map(url);
    [publicarInstagram, publicarFacebook] = [instagram, facebook];
    console.log(`${teste ? '[TESTE] ' : ''}Post ${slot}: ${imagens.length} imagem(ns)`);
  }

  // Instagram primeiro: se falhar, o post fica na fila e nada sai.
  const resultado = { slot, formato: ehReel ? 'reel' : 'post', publicado_em: new Date().toISOString() };
  resultado.instagram = await publicarInstagram(urls, legenda, teste);
  console.log('✓ Instagram', resultado.instagram.permalink || resultado.instagram.teste);

  let erroFacebook = null;
  try {
    resultado.facebook = await publicarFacebook(urls, legenda, teste);
    console.log('✓ Facebook', resultado.facebook.permalink || resultado.facebook.teste);
  } catch (err) {
    erroFacebook = err;
    resultado.facebook = { erro: err.message };
    console.error('✗ Facebook', err.message);
  }

  // Story de divulgação: falha aqui não desfaz o post do feed, só fica registrada.
  if (temStory) {
    const storyUrl = `https://raw.githubusercontent.com/${REPO}/${REF}/fila/${slot}/story.jpg`;
    resultado.stories = {};
    for (const [rede, publicarStory] of [['instagram', storyInstagram], ['facebook', storyFacebook]]) {
      try {
        resultado.stories[rede] = await publicarStory(storyUrl, teste);
        console.log(`✓ Story ${rede}`, resultado.stories[rede].teste || resultado.stories[rede].id);
      } catch (err) {
        resultado.stories[rede] = { erro: err.message };
        console.error(`✗ Story ${rede}`, err.message);
      }
    }
  }

  if (teste) return;

  // Já saiu no Instagram: move para publicados mesmo se o Facebook falhou, para não repetir.
  fs.writeFileSync(path.join(pasta, 'resultado.json'), JSON.stringify(resultado, null, 2) + '\n');
  fs.mkdirSync(PUBLICADOS, { recursive: true });
  fs.renameSync(pasta, path.join(PUBLICADOS, slot));
  limparMidiasAntigas();
  if (erroFacebook) process.exitCode = 1;
}

// Mantém o repositório leve: apaga imagens e vídeos de publicados com mais de 7 dias
// (o resultado.json, a legenda e a origem ficam como histórico).
function limparMidiasAntigas() {
  const limite = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  for (const slot of fs.readdirSync(PUBLICADOS)) {
    if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(slot) || slot.slice(0, 10) >= limite) continue;
    const dir = path.join(PUBLICADOS, slot);
    for (const f of fs.readdirSync(dir)) {
      if (/\.(jpe?g|png|mp4)$/i.test(f)) fs.unlinkSync(path.join(dir, f));
    }
  }
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
