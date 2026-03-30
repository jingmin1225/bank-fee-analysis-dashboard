// documentManagers.js
const crudFactory = require('../services/crudFactory');
module.exports = crudFactory('document_managers',
  ['conditions','assigned_user_ids','assigned_user_group_ids','notification_template_id','is_active'],
  { searchCols: [] }
);
