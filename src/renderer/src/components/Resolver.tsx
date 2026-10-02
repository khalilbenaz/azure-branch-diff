import { useEffect, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import type { FileSide, Resolution } from '../../../shared/types';
import { languageFor } from '../lib/eol';
import { toResolution } from '../lib/prLogic';
import { useMonacoTheme } from '../lib/theme';
import '../lib/monaco';

interface Props {
  path: string;
  sides: { source: FileSide; target: FileSide; merged?: FileSide };
  sourceLabel: string;
  targetLabel: string;
  busy: boolean;
  /** Libellé du bouton de validation (« Valider la résolution », « Marquer résolu »). */
  submitLabel: string;
  resultHint: string;
  onSubmit(r: Resolution): void;
}

/** Éditeur 3 volets : source et cible en lecture, résultat modifiable. Pour les fichiers texte. */
export function Resolver({ path, sides, sourceLabel, targetLabel, busy, submitLabel, resultHint, onSubmit }: Props) {
  const theme = useMonacoTheme();
  // Point de départ : le fichier fusionné par git (marqueurs + parties sans conflit) s'il est fourni, sinon la cible.
  const initial = sides.merged?.content ?? sides.target.content;
  const [result, setResult] = useState(initial);
  useEffect(() => setResult(initial), [initial, path]);
  const lang = languageFor(path);
  const ro = { readOnly: true, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, fontSize: 13 };
  const bom = !!(sides.target.bom || sides.source.bom);

  return (
    <>
      <div className="resolver-top">
        <div className="pane">
          <div className="pane-title">
            <span className="dot" style={{ background: 'var(--accent)' }} />
            <strong>Source</strong>
            <span className="mono muted">{sourceLabel}</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => setResult(sides.source.content)}>
              Garder source
            </button>
          </div>
          <Editor value={sides.source.content} language={lang} theme={theme} options={ro} />
        </div>
        <div className="pane">
          <div className="pane-title">
            <span className="dot" style={{ background: 'var(--warn)' }} />
            <strong>Cible</strong>
            <span className="mono muted">{targetLabel}</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => setResult(sides.target.content)}>
              Garder cible
            </button>
          </div>
          <Editor value={sides.target.content} language={lang} theme={theme} options={ro} />
        </div>
      </div>
      <div className="pane result">
        <div className="pane-title">
          <strong>Résultat (modifiable)</strong>
          <span className="muted">{resultHint}</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setResult(`${sides.source.content}\n${sides.target.content}`)}>
            Garder les deux
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => onSubmit(toResolution(result, sides.source.content, sides.target.content, bom))}
          >
            {busy ? 'Envoi…' : submitLabel}
          </button>
        </div>
        <Editor
          value={result}
          onChange={(v) => setResult(v ?? '')}
          language={lang}
          theme={theme}
          options={{ minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, fontSize: 13 }}
        />
      </div>
    </>
  );
}
