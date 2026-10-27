// Historical schema fixture, before normalized source-plan stores.
export const V10_STORES = {
  plan: 'id', foods: 'id, name', entries: 'id, at, kind', wellbeing: 'date', workouts: 'id, date', weights: 'date', labs: '[date+name], name',
  recipes: 'id, name', sync: 'tid', meta: 'key', favorites: 'id, title', frictions: 'id, at', pieces: 'id', tally: 'day', pilot: 'key',
  moduleEvents: 'id, at, kind', profile: 'key', reviewDrafts: 'id',
};
