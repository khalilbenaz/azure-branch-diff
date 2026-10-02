import { DiffEditor } from '@monaco-editor/react';
import type { ChangeEntry, FileSide } from '../../../shared/types';
import { BADGE } from './FileTree';
import { IconExternal } from '../lib/icons';
import { isEolOnlyDiff, languageFor } from '../lib/eol';
import { useMonacoTheme } from '../lib/theme';
import '../lib/monaco';

interface Props {
  entry: ChangeEntry | null;
  sides: { left: FileSide; right: FileSide } | null;
  loading: boolean;
  leftLabel: string;
  rightLabel: string;
  sideBySide: boolean;
  onToggleLayout(): void;
  onOpenInAzure(): void;
  /** Faux pour un fichier qui n'existe qu'en local. */
  canOpenInAzure: boolean;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function DiffView({ entry, sides, loading, leftLabel, rightLabel, sideBySide, onToggleLayout, onOpenInAzure, canOpenInAzure }: Props) {
  const theme = useMonacoTheme();
  if (!entry)
    return (
      <div className="diff">
        <div className="diff-empty">Sélectionnez un fichier pour afficher le diff.</div>
      </div>
    );

  const header = (
    <div className="diff-head">
      <span className={`badge badge-${entry.change}`}>{BADGE[entry.change]}</span>
      <span className="diff-path" title={entry.path}>
        {entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path}
      </span>
      <span className="spacer" />
      <div className="segmented sm" role="group" aria-label="Affichage du diff">
        <button aria-pressed={sideBySide} onClick={() => !sideBySide && onToggleLayout()}>
          Côte à côte
        </button>
        <button aria-pressed={!sideBySide} onClick={() => sideBySide && onToggleLayout()}>
          Unifié
        </button>
      </div>
      <button
        className="btn btn-ghost btn-sm"
        onClick={onOpenInAzure}
        disabled={!canOpenInAzure}
        title={canOpenInAzure ? '' : 'Fichier uniquement local'}
      >
        Ouvrir dans Azure <IconExternal />
      </button>
    </div>
  );
  const sidesRow = (
    <div className="diff-sides">
      <div title={leftLabel}>{leftLabel}</div>
      <div title={rightLabel}>{rightLabel}</div>
    </div>
  );

  if (loading || !sides) {
    return (
      <div className="diff">
        {header}
        <div className="diff-empty">Chargement…</div>
      </div>
    );
  }

  const blocked = [sides.left, sides.right].find((s) => s.isBinary || s.tooLarge);
  if (blocked) {
    const size = Math.max(sides.left.sizeBytes, sides.right.sizeBytes);
    return (
      <div className="diff">
        {header}
        <div className="diff-empty">
          <p>
            Pas de diff : fichier {blocked.isBinary ? 'binaire' : 'trop volumineux (> 2 Mo)'} — {kb(size)}.
          </p>
          {canOpenInAzure && (
            <button className="btn" onClick={onOpenInAzure}>
              Ouvrir dans Azure
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="diff">
      {header}
      {sidesRow}
      {(sides.left.lossy || sides.right.lossy) && (
        <div className="banner banner-info">
          Fichier non UTF-8 (ex. Windows-1252) : certains caractères accentués peuvent s'afficher incorrectement.
        </div>
      )}
      {isEolOnlyDiff(sides.left.content, sides.right.content) && (
        <div className="banner banner-info">Différences de fins de ligne uniquement (CRLF / LF).</div>
      )}
      <div className="diff-editor">
        <DiffEditor
          key={entry.path}
          original={sides.left.content}
          modified={sides.right.content}
          language={languageFor(entry.path)}
          theme={theme}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: sideBySide,
            // Côte à côte respecté jusqu'à 600 px (Monaco passe sinon en vue unifiée vers 900 px).
            renderSideBySideInlineBreakpoint: 600,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: 'boundary',
            fontSize: 13,
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          }}
        />
      </div>
    </div>
  );
}
