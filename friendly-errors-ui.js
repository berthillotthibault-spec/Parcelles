// n° 126 : toast d'erreur humain avec « Détails » (Diagnostic) et « Copier le rapport ».
import {friendlyError, errorReport} from './friendly-errors.js';
import {recordDiagnosticError} from './diagnostics.js';

export function createFriendlyErrorsUI({toast, openDiagnostic, copyText, buildId = '', nav = globalThis.navigator}) {
  const online = () => nav?.onLine !== false;
  function show(error, {source = 'action', record = true} = {}) {
    const f = friendlyError(error, {online: online()});
    if (record) recordDiagnosticError({buildId, source, message: `${f.kind}: ${error?.message ?? error}`, stack: error?.stack});
    const copy = async () => {
      const ok = await copyText(errorReport(error, {buildId, userAgent: nav?.userAgent || '', online: online()}));
      toast(ok ? 'Rapport copié : collez-le dans votre message au support.' : 'Copie impossible sur ce navigateur.', ok ? 'success' : 'error');
    };
    toast(f.own ? f.cause : `${f.title}. ${f.cause} ${f.action}`, 'error', [{label: 'Détails', run: openDiagnostic}, {label: 'Copier le rapport', run: copy}]);
    return f;
  }
  return {show};
}
