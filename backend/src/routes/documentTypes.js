const crudFactory = require('../services/crudFactory');
module.exports = crudFactory('document_types',
  ['name','description','category','entity_type','is_sensitive','is_active'],
  { searchCols: ['name','description','category'] }
);
