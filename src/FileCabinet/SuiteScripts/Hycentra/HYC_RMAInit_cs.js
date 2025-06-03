/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */

define([], function() {

  function pageInit(context) {
    var currentRecord = context.currentRecord;
    var mode = context.mode;
    
    if (currentRecord.type === 'returnauthorization' && mode === 'copy') {
      currentRecord.setValue({
        fieldId: 'memo',
        value: ''
      });
    }
  }
  
  return {
    pageInit: pageInit
  };

});