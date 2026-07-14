'use strict'
/**
 * [EN]    CAdES (CMS) signing — PKCS#12 pre-imported certificate (one-step).
 *         No visual signature fields. Use signaturePackaging: ENVELOPING | ENVELOPED | DETACHED.
 * [PT-BR] Assinatura CAdES (CMS) — certificado PKCS#12 pré-importado (passo único).
 *         Sem campos visuais. Use signaturePackaging: ENVELOPING | ENVELOPED | DETACHED.
 */
const fs   = require('fs')
const path = require('path')
const JSZip = require('jszip')

async function signCmsPkcs12({ authorization, baseUrl, pfxCode, files, sigParams = {} }) {
  const form = new FormData()
  files.forEach(({ buffer, filename }, i) => form.append(`document[${i}]`, new Blob([buffer]), filename))

  form.append('pfxCode', pfxCode)
  appendSigParamsCms(form, sigParams)

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/solidsign/dsig/cms/sign-pkcs12`, {
    method: 'POST',
    headers: { Authorization: authorization },
    body: form,
  })
  if (!resp.ok) { console.error(`SolidSign error ${resp.status}: ${await resp.text()}`); return null }

  const signResp = await resp.json()
  return downloadAndZip(signResp, files.map(f => f.filename), authorization)
}

async function signBatch() {
  const inputPath  = process.env.SOLIDSIGN_BATCH_INPUT_PATH ?? ''
  const outputPath = process.env.SOLIDSIGN_BATCH_OUTPUT_PATH ?? ''
  const allFiles   = fs.readdirSync(inputPath)

  if (!allFiles.length) { console.log(`No files found in ${inputPath}`); return null }
  console.log(`Found ${allFiles.length} files for local processing.`)

  const files = allFiles.map(f => ({ buffer: fs.readFileSync(path.join(inputPath, f)), filename: f }))

  const zipBuf = await signCmsPkcs12({
    authorization: process.env.SOLIDSIGN_AUTHORIZATION,
    baseUrl:       process.env.SOLIDSIGN_BASE_URL,
    pfxCode:       process.env.SOLIDSIGN_CERT_ID,
    files,
    sigParams: {
      profile:              process.env.SOLIDSIGN_PROFILE,
      hashAlgorithm:        process.env.SOLIDSIGN_HASH_ALGORITHM,
      policyVersion:        process.env.SOLIDSIGN_POLICY_VERSION,
      signaturePackaging:   process.env.SOLIDSIGN_SIGNATURE_PACKAGING,
    },
  })
  if (!zipBuf) return null

  if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true })
  const outPath = path.join(outputPath, `signed_cms_pkcs12_${Date.now()}.zip`)
  fs.writeFileSync(outPath, zipBuf)
  console.log(`CAdES PKCS12 signing complete. Output: ${outPath}`)
  return outPath
}

function appendSigParamsCms(form, p) {
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') form.append(k, String(v)) }
  add('profile', p.profile); add('hashAlgorithm', p.hashAlgorithm); add('policyVersion', p.policyVersion)
  add('signaturePackaging', p.signaturePackaging)
  add('encapsulatedTimestampConfig', p.encapsulatedTimestampConfig)
  add('documentInfoMetadata', p.documentInfoMetadata)
}

async function downloadAndZip(signResp, originalNames, auth) {
  const zip = new JSZip()
  for (let i = 0; i < signResp.documents.length; i++) {
    const selfLink = signResp.documents[i]._links?.self || (signResp.documents[i].links || []).find(l => l.rel === 'self')
    if (!selfLink) continue
    const dlResp = await fetch(selfLink.href, { headers: { Authorization: auth } })
    if (!dlResp.ok) continue
    zip.file(`signed_${originalNames[i]}`, Buffer.from(await dlResp.arrayBuffer()))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

module.exports = { signCmsPkcs12, signBatch, appendSigParamsCms, downloadAndZip }
