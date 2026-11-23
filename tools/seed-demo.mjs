// Jeu de données de démonstration partagé par les outils Playwright (audit de la maquette, n° 146 régression visuelle).
// La fonction s'exécute DANS la page (page.evaluate) : elle ne doit rien capturer de ce module.
// Toujours dans un profil de navigateur vierge, jamais sur les données de l'utilisateur.
// Identifiants fixes et dates relatives à Date.now() : avec une horloge figée (page.clock), le rendu est déterministe.
export async function seedDemoFarm() {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init(); if (s.state.parcelles.length) return false;
  const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d * 0.7], [x, y + d * 0.7], [x, y]]]});
  const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), today = D(0);
  for (const [id, nom, culture, surfaceHa, x, y, favorite] of [['p1', 'Les Noues', 'Blé tendre', 11.3, 5.13, 46.34, true], ['p2', 'Grand Champ', 'Maïs grain', 8.2, 5.136, 46.34, false], ['p3', 'Le Pré Bas', 'Prairie permanente', 4.6, 5.142, 46.34, false], ['p4', 'La Côte', 'Colza', 6.1, 5.13, 46.345, false], ['p5', 'Le Grand Pré', 'Prairie temporaire', 3.9, 5.136, 46.345, false]])
    await s.upsert('parcelles', {id, nom, culture, surfaceHa, commune: 'Montrevel', favorite, geometry: sq(x, y)});
  await s.upsert('interventions', {id: 'w1', parcelId: 'p2', type: 'Récolte maïs', date: today, plannedDate: today, status: 'À faire', startTime: '08:30'});
  await s.upsert('interventions', {id: 'w2', parcelId: 'p1', type: 'Semis blé', date: today, plannedDate: today, status: 'À faire', startTime: '14:00'});
  await s.upsert('interventions', {id: 'w3', parcelId: 'p4', type: 'Désherbage', date: D(-3), plannedDate: D(-3), status: 'À faire'});
  await s.upsert('tasks', {id: 't1', title: 'Réparer clôture', parcelId: 'p3', dueDate: today, status: 'À faire'});
  await s.upsert('grazingSessions', {id: 'g1', parcelId: 'p3', animalType: 'Vaches', animalsCount: 24, startDate: D(-18)});
  await s.upsert('materiels', {id: 'm1', nom: 'Tracteur', location: 'Hangar'});
  // n° 160 : troupeau pour la vue Troupeau (un lot au pré, des animaux au bâtiment, deux vêlages à venir).
  await s.upsert('grazingSessions', {id: 'g0', parcelId: 'p5', animalType: 'Génisses', animalsCount: 9, startDate: D(-70), endDate: D(-40)});
  for (const [id, nationalId, name, sex, sessionId] of [['a1', 'FR0112344521', 'Marguerite', 'F', 'g1'], ['a2', 'FR0112344388', 'Bella', 'F', ''], ['a3', 'FR0112347702', 'Hercule', 'M', '']])
    await s.upsert('animals', {id, nationalId, name, sex, breed: 'Montbéliarde', birthDate: '2021-03-02', entryDate: '2021-03-02', origin: 'birth', ...(sessionId ? {sessionId} : {})});
  await s.upsert('animalEvents', {id: 'e1', animalId: 'a1', kind: 'insemination', date: D(5 - 283)});
  await s.upsert('animalEvents', {id: 'e2', animalId: 'a2', kind: 'insemination', date: D(9 - 283)});
  return true;
}
