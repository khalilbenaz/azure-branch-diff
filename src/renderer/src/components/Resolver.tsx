import { useEffect, useMemo, useRef, useState } from 'react';
import { Editor, type OnMount } from '@monaco-editor/react';
import type { FileSide, Resolution } from '../../../shared/types';
import { languageFor } from '../lib/eol';
import { toResolution } from '../lib/prLogic';
import { useMonacoTheme } from '../lib/theme';
import { applyChoice, conflictBlocks, type BlockChoice } from '../lib/conflictBlocks';
import '../lib/monaco';

interface Props {
  path: string;
  sides: { source: FileSide; target: FileSide; merged?: FileSide };
  sourceLabel: string;
  targetLabel: string;
  busy: boolean;
  /** Libellé du bouton de validation (« Valider la résolution », « Valider ce fichier »). */
  submitLabel: string;
  resultHint: string;
  onSubmit(r: Resolution): void;
}

/** Nom lisible d'une branche : « origin/main » → « main ». */
const short = (label: string) => label.replace(/^origin\//, '');

/**
 * Résolution d'un fichier texte.
 * Avec des marqueurs de conflit (merge local) : un conflit à la fois, version cible et version source côte à côte,
 * « Garder … » remplace ce seul bloc dans le fichier final, qui reste modifiable à la main.
 * Sans marqueurs (conflit de PR Azure) : les deux fichiers complets et le résultat.
 */
export function Resolver({ path, sides, sourceLabel, targetLabel, busy, submitLabel, resultHint, onSubmit }: Props) {
  const theme = useMonacoTheme();
  // Point de départ : le fichier fusionné par git (marqueurs + parties sans conflit) s'il est fourni, sinon la cible.
  const initial = sides.merged?.content ?? sides.target.content;
  const [result, setResult] = useState(initial);
  const [showFull, setShowFull] = useState(false);
  const [mounted, setMounted] = useState(0);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => {
    setResult(initial);
    setShowFull(false);
  }, [initial, path]);

  const lang = languageFor(path);
  const ro = { readOnly: true, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, fontSize: 13 };
  const bom = !!(sides.target.bom || sides.source.bom);
  const tName = short(targetLabel);
  const sName = short(sourceLabel);

  const blocks = useMemo(() => conflictBlocks(result), [result]);
  const total = useMemo(() => conflictBlocks(initial).length, [initial]);
  const withMarkers = total > 0;
  const block = blocks[0];

  // Le fichier final suit le conflit en cours ; les conflits restants y sont surlignés.
  const decoRef = useRef<{ set(d: unknown[]): void; clear(): void } | null>(null);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (block) ed.revealLineInCenter(block.startLine);
    const lineOf = (offset: number) => result.slice(0, offset).split('\n').length;
    const decos = blocks.map((b, i) => ({
      range: { startLineNumber: b.startLine, startColumn: 1, endLineNumber: lineOf(b.end - 1), endColumn: 1 },
      options: { isWholeLine: true, className: i === 0 ? 'conflict-current' : 'conflict-range' },
    }));
    if (!decoRef.current) decoRef.current = ed.createDecorationsCollection() as unknown as { set(d: unknown[]): void; clear(): void };
    decoRef.current.set(decos);
  }, [blocks, block, result, mounted]);

  const choose = (c: BlockChoice) => setResult((r) => applyChoice(r, 0, c));
  const submit = () => onSubmit(toResolution(result, sides.source.content, sides.target.content, bom));

  const fullPanes = (
    <div className="resolver-top">
      <div className="pane">
        <div className="pane-title">
          <span className="dot" style={{ background: 'var(--warn)' }} />
          <strong>{tName}</strong>
          <span className="muted">cible · fichier complet</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setResult(sides.target.content)}>
            Tout prendre de {tName}
          </button>
        </div>
        <Editor value={sides.target.content} language={lang} theme={theme} options={ro} />
      </div>
      <div className="pane">
        <div className="pane-title">
          <span className="dot" style={{ background: 'var(--accent)' }} />
          <strong>{sName}</strong>
          <span className="muted">source · fichier complet</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setResult(sides.source.content)}>
            Tout prendre de {sName}
          </button>
        </div>
        <Editor value={sides.source.content} language={lang} theme={theme} options={ro} />
      </div>
    </div>
  );

  return (
    <>
      {withMarkers && !showFull ? (
        <div className="block-card" role="region" aria-label="Conflit en cours">
          {block ? (
            <>
              <div className="block-head">
                <strong>
                  Conflit {total - blocks.length + 1} sur {total}
                </strong>
                <span className="muted">ligne {block.startLine} du fichier · les deux branches ont modifié ces lignes</span>
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setShowFull(true)}>
                  Voir les fichiers complets
                </button>
              </div>
              <div className="block-sides">
                <div className="block-side">
                  <div className="block-label">
                    <span className="dot" style={{ background: 'var(--warn)' }} />
                    <strong>{tName}</strong> <span className="muted">(cible)</span>
                  </div>
                  <pre className="block-code">{block.target || '(rien)'}</pre>
                  <button className="btn" onClick={() => choose('target')}>
                    Garder {tName}
                  </button>
                </div>
                <div className="block-side">
                  <div className="block-label">
                    <span className="dot" style={{ background: 'var(--accent)' }} />
                    <strong>{sName}</strong> <span className="muted">(source)</span>
                  </div>
                  <pre className="block-code">{block.source || '(rien)'}</pre>
                  <button className="btn" onClick={() => choose('source')}>
                    Garder {sName}
                  </button>
                </div>
              </div>
              <div className="block-foot">
                <button className="btn btn-sm" onClick={() => choose('both')}>
                  Garder les deux ({tName} puis {sName})
                </button>
                <span className="muted small">ou modifiez directement le fichier final ci-dessous.</span>
              </div>
            </>
          ) : (
            <div className="block-done">
              <strong>Tous les conflits de ce fichier sont réglés.</strong>
              <span className="muted">Relisez le fichier final, puis validez-le.</span>
              <span className="spacer" />
              <button className="btn btn-sm btn-ghost" onClick={() => setShowFull(true)}>
                Voir les fichiers complets
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {withMarkers && (
            <div className="block-back">
              <button className="btn btn-sm btn-ghost" onClick={() => setShowFull(false)}>
                ← Revenir conflit par conflit
              </button>
            </div>
          )}
          {fullPanes}
        </>
      )}
      <div className="pane result">
        <div className="pane-title">
          <strong>Fichier final</strong>
          <span className="muted">
            modifiable · {resultHint}
            {blocks.length > 0 && ' · conflits restants surlignés'}
          </span>
          <span className="spacer" />
          {!withMarkers && (
            <button className="btn btn-sm" onClick={() => setResult(`${sides.source.content}\n${sides.target.content}`)}>
              Garder les deux
            </button>
          )}
          {blocks.length > 0 && (
            <span className="small warn-text">
              {blocks.length} conflit{blocks.length > 1 ? 's' : ''} restant{blocks.length > 1 ? 's' : ''}
            </span>
          )}
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || blocks.length > 0}
            title={blocks.length ? 'Réglez d’abord les conflits de ce fichier' : ''}
            onClick={submit}
          >
            {busy ? 'Envoi…' : submitLabel}
          </button>
        </div>
        <Editor
          value={result}
          onChange={(v) => setResult(v ?? '')}
          onMount={(ed) => {
            editorRef.current = ed;
            decoRef.current = null;
            setMounted((n) => n + 1); // applique les surlignages dès l'ouverture
          }}
          language={lang}
          theme={theme}
          options={{ minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, fontSize: 13 }}
        />
      </div>
    </>
  );
}
