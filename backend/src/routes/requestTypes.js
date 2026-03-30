// requestTypes.js
const crudFactory = require('../services/crudFactory');
module.exports = crudFactory('request_types',
  ['name','description','mapped_entity_type','is_active'],
  { searchCols: ['name','description'] }
);
