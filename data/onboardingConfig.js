// ==================== CONFIGURATION ====================
// Easy to modify - add or remove onboarding categories and roles here
// This configuration follows the same modular structure as role-menu.js
// and is almost interchangeable with the inline config in captcha-onboarding.js

// Gate role that is removed when user completes captcha
const GATE_ROLE_ID = '1425702277410455654';

const ONBOARDING_CATEGORIES = [
  {
    name: 'Pronouns',
    description: 'Select your pronouns',
    emoji: '🏳️‍🌈',
    selectionType: 'REQUIRED_ONE', // REQUIRED_ONE, ONLY_ONE, MULTIPLE, NONE_OR_ONE, NONE_OR_MULTIPLE
    roles: [
      { id: '1346026355749425162', name: 'He/Him', emoji: '👨', key: 'hehim' },
      { id: '1346026308253122591', name: 'She/Her', emoji: '👩', key: 'sheher' },
      { id: '1346026355112022036', name: 'They/Them', emoji: '🧑', key: 'theythem' }
    ]
  },
  {
    name: 'Region',
    description: 'Select your region',
    emoji: '🌍',
    selectionType: 'REQUIRED_ONE',
    roles: [
      { id: '1346009391907737631', name: 'North America', emoji: '🌎', key: 'na' },
      { id: '1346008779929550891', name: 'South America', emoji: '🌎', key: 'sa' },
      { id: '1346007791344680980', name: 'Europe', emoji: '🌍', key: 'eu' },
      { id: '1346008958178955366', name: 'Asia', emoji: '🌏', key: 'asia' },
      { id: '1346008958178955366', name: 'Australia', emoji: '🦘', key: 'oceania' },
      { id: '1346009038306934836', name: 'Africa', emoji: '🌍', key: 'africa' }
    ]
  },
  {
    name: 'Age',
    description: 'Select your age range',
    emoji: '🎂',
    selectionType: 'REQUIRED_ONE',
    roles: [
      { id: '1364164214272561203', name: '18-25', emoji: '🔞', key: 'age_18_25' },
      { id: '1346238384003219577', name: '25+', emoji: '🔞', key: 'age_25_plus' }
    ]
  },
  {
    name: 'Gaming',
    description: 'Do you enjoy video gaming?',
    emoji: '🎮',
    selectionType: 'REQUIRED_ONE',
    roles: [
      { id: '1363056342088290314', name: 'Gamer', emoji: '🎮', key: 'gamer' },
      { id: '1363056678299504710', name: 'Grass Toucher', emoji: '🌱', key: 'grass' }
    ]
  }
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Get category by name
 */
function getCategoryByName(categoryName) {
  return ONBOARDING_CATEGORIES.find(cat => cat.name === categoryName);
}

/**
 * Get all role IDs from a category
 */
function getCategoryRoleIds(category) {
  return category.roles.map(role => role.id);
}

/**
 * Get role config by key within a category
 */
function getRoleByKey(category, key) {
  return category.roles.find(role => role.key === key);
}

// ==================== EXPORTS ====================

module.exports = {
  ONBOARDING_CATEGORIES,
  GATE_ROLE_ID,
  getCategoryByName,
  getCategoryRoleIds,
  getRoleByKey,
  
  // Legacy format for backwards compatibility (if needed)
  // Can be removed once all code is migrated to new structure
  pronouns: ONBOARDING_CATEGORIES.find(cat => cat.name === 'Pronouns')?.roles || [],
  continents: ONBOARDING_CATEGORIES.find(cat => cat.name === 'Region')?.roles || [],
  ages: ONBOARDING_CATEGORIES.find(cat => cat.name === 'Age')?.roles || [],
  gaming: ONBOARDING_CATEGORIES.find(cat => cat.name === 'Gaming')?.roles || [],
};
