/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/runtime', 'N/log', './itemFormHelper'], function (record, runtime, log, itemFormHelper) {
    function beforeSubmit(context) {
        // Ensure script only runs during CSV Import
        if (runtime.executionContext !== runtime.ContextType.CSV_IMPORT) {
            return;
        }

        var newRecord = context.newRecord;
        var recordType = newRecord.type;

        // Ensure the script runs only for Inventory Items or Kit/Package
        if (recordType !== record.Type.INVENTORY_ITEM && recordType !== record.Type.KIT_ITEM) {
            return;
        }

        log.audit('CSV Import Detected', 'Processing Record ID: ' + newRecord.id + ', Type: ' + recordType);

        // Retrieve the selected Category (Class)
        var categoryId = newRecord.getValue({ fieldId: 'class' });

        if (!categoryId) {
            log.error('Missing Category', 'Category (Class) is required.');
            return;
        }

        // Get the correct Form ID based on the category
        var correctFormId = itemFormHelper.getCategoryFormId(itemFormHelper.getItemTypeId(recordType), categoryId);

        if (!correctFormId) {
            log.error('No Matching Form', 'No associated form found for Category ID: ' + categoryId);
            return;
        }

        // Assign the correct Form ID
        newRecord.setValue({
            fieldId: 'customform',
            value: correctFormId
        });

        log.audit('Form Updated', 'Form ID set to: ' + correctFormId + ' for Category ID: ' + categoryId);
    }

    return {
        beforeSubmit: beforeSubmit
    };
});