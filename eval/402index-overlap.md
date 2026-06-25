# 402index.io vs OASIS — source overlap

Objective: can 402index alone subsume our ingestion? Our gated index = 21728 endpoints / 1117 hosts. 402index pull = 71049 host+path / 1958 hosts.

## Verdict — how much of OURS is in 402index
- **host+path match: 13566/21358 (63.5%)** — exact endpoints of ours present in 402index
- **host match: 1074/1117 (96.2%)** — providers of ours present in 402index
- gap (ours NOT in 402index): **7792 endpoints across 269 hosts** ← what we'd lose
- 402index hosts NEW to us: **884** ← potential gain

## Our overlap, by 402index source (where our endpoints come from in their data)
- bazaar: 12798
- mpp: 620
- satring: 68
- self-registered: 57
- sponge: 9
- discovery: 9
- bazaar,sponge: 5

## Top gap hosts (ours, absent from 402index — eyeball for x402scan/pay.sh origins)
| host | our endpoints |
|---|---|
| agent402-production.up.railway.app | 1333 |
| mpp.orthogonal.com | 566 |
| x402.agentutility.ai | 541 |
| x402-deployer.x402-deployer.workers.dev | 417 |
| api.getanyapi.com | 194 |
| stablecrypto.dev | 157 |
| stablesocial.dev | 154 |
| wurkapi.fun | 154 |
| 2s.io | 146 |
| simple-x-api.com | 137 |
| x402.quicknode.com | 130 |
| social.gedx402.com | 106 |
| apify-api-git-apify-top100-routes-merit-systems.vercel.app | 102 |
| apify-api-git-br-better-actor-pay-merit-systems.vercel.app | 99 |
| apify-api-git-br-apify-typed-input-schemas-merit-systems.vercel.app | 98 |
| atelierai.xyz | 89 |
| verifik.x402.paysponge.com | 89 |
| blockrun-web-vbsbhh7lea-uc.a.run.app | 82 |
| gateway.spraay.app | 80 |
| api.babyblueviper.com | 79 |
| x402stock.xyz | 73 |
| api.strale.io | 69 |
| stable-travel-git-migrate-stabletravel-router-140-merit-systems.vercel.app | 69 |
| api.glianalabs.com | 68 |
| win.oneshotagent.com | 66 |
| x402trustlayer.xyz | 63 |
| x402.fullstack.cash | 62 |
| api.loyalspark.online | 61 |
| api.relaystation.ai | 55 |
| stableapify.dev | 54 |

## 402index composition (context)
by source: bazaar=67515, self-registered=2129, mpp=1253, satring=436, sponge=181, discovery=167, self-registered,l402apps=76, l402apps=74, satring,l402apps=34, bazaar,sponge=26, l402directory,l402apps=9, self-registered,l402directory=6, discovery,l402apps=4, l402directory=2, exclusive=1

by health: degraded=37097, healthy=22587, down=12138, unknown=91