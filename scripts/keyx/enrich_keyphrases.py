#!/usr/bin/env python3
"""INGEST-time keyphrase enrichment (local, offline). Adds `keyphrases` to each endpoint in the
OASIS index using spaCy noun-chunks + Adj/Noun POS patterns (lemmatized, deduped). These power the
SERVE-time keyword-relevance match against the query (string ops only — no live model on the MCP).

Usage: python3 scripts/keyx/enrich_keyphrases.py <in_index.json> <out_index.json>
Requires: pip install spacy && python -m spacy download en_core_web_sm
"""
import json, sys, re, warnings; warnings.filterwarnings("ignore")
import spacy
from spacy.matcher import Matcher

nlp = spacy.load("en_core_web_sm", disable=["ner"])  # ingest: chunks/POS only
matcher = Matcher(nlp.vocab)
matcher.add("AN", [[{"POS": {"IN": ["ADJ", "NOUN", "PROPN"]}, "OP": "*"}, {"POS": {"IN": ["NOUN", "PROPN"]}}]])
STRIP = re.compile(r"\b(api|x402|usdc|paid|pay|per|call|endpoint|via|using|returns?|get|post)\b", re.I)

def keyphrases(text):
    text = STRIP.sub(" ", text or "")[:300]
    doc = nlp(text)
    ph = set()
    for c in doc.noun_chunks:
        t = " ".join(tok.lemma_.lower() for tok in c if not tok.is_stop and tok.is_alpha and len(tok) > 2)
        if t: ph.add(t)
    for _, s, e in matcher(doc):
        t = " ".join(tok.lemma_.lower() for tok in doc[s:e] if not tok.is_stop and tok.is_alpha and len(tok) > 2)
        if t: ph.add(t)
    # also keep salient single content lemmas (so model-name tokens like 'dall', 'flux' survive)
    for tok in doc:
        if tok.is_alpha and not tok.is_stop and tok.pos_ in ("NOUN", "PROPN", "VERB", "ADJ") and len(tok) > 2:
            ph.add(tok.lemma_.lower())
    return sorted(ph)

def main(inp, outp):
    idx = json.load(open(inp))
    eps = idx["endpoints"] if isinstance(idx, dict) and "endpoints" in idx else idx
    texts = [((e.get("summary", "") or "") + ". " + (e.get("description", "") or "")) for e in eps]
    n = 0
    for e, doc in zip(eps, nlp.pipe(texts, batch_size=128)):
        # reuse the pipe doc for chunks; recompute matcher on it
        ph = set()
        for c in doc.noun_chunks:
            t = " ".join(tok.lemma_.lower() for tok in c if not tok.is_stop and tok.is_alpha and len(tok) > 2)
            if t: ph.add(t)
        for tok in doc:
            if tok.is_alpha and not tok.is_stop and tok.pos_ in ("NOUN", "PROPN", "VERB", "ADJ") and len(tok) > 2:
                ph.add(tok.lemma_.lower())
        e["keyphrases"] = sorted(ph)[:24]
        n += 1
        if n % 4000 == 0: print(f"  ...{n}", file=sys.stderr)
    json.dump(idx, open(outp, "w"))
    print(f"enriched {n} endpoints -> {outp}", file=sys.stderr)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
