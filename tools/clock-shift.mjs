// Préchargement de test : avance l'horloge de SHIFT_DAYS jours (400 par défaut) pour Date() et Date.now().
// Les dates explicites (new Date('2026-10-01')) ne bougent pas : un test qui compare une date codée en dur
// au jour réel échoue donc ici avant d'échouer en vrai. Utilisé par tools/test-horloge.mjs.
const OFFSET = Number(process.env.SHIFT_DAYS || 400) * 864e5;
const RealDate = Date;
class ShiftedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + OFFSET); else super(...args); }
  static now() { return RealDate.now() + OFFSET; }
}
globalThis.Date = ShiftedDate;
