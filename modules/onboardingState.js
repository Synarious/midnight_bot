const selections = new Map();

function getState(userId) {
  return selections.get(userId) || {
    pronoun: null,
    continent: null,
    age: null,
  };
}

function setSelection(userId, category, data) {
  const current = getState(userId);
  const updated = { ...current, [category]: data };
  selections.set(userId, updated);
  return updated;
}

function clear(userId) {
  selections.delete(userId);
}

module.exports = {
  getState,
  setSelection,
  clear,
};
