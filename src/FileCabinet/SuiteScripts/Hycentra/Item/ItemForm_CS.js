/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
define(['N/record', 'N/log', 'N/format', '../moment.min.js', './itemFormHelper'],
    function(record, log, format, moment, formHelper) {

    var currentRecord;
    var scriptInitiatedChange = false;

    function pageInit(context) {
        currentRecord = context.currentRecord;

        // Make sure the correct category is associating with the form
        setStickyCategory();
    }

    function setStickyCategory() {
        if (!scriptInitiatedChange) {
            var currentCategoryId = currentRecord.getValue({fieldId: 'class'});

            if (currentCategoryId) {
                var formCategoryId = formHelper.getFormCategoryId(1, currentCategoryId, currentRecord.getValue({fieldId: 'customform'}));

                if (formCategoryId && currentCategoryId != formCategoryId) {
                    scriptInitiatedChange = true;
                    currentRecord.setValue({
                        fieldId: 'class',
                        value: formCategoryId
                    });
                }
            }
        }
    }

    function fieldChanged(context) {
        if (scriptInitiatedChange) {
            // Reset the flag and return to avoid infinite loop
            scriptInitiatedChange = false;
            return;
        } else {
            // Check if the field changed is the product category
            if (context.fieldId === 'class') {
                var categoryId = currentRecord.getValue({fieldId: 'class'});

                // Change the input form base on the category
                currentRecord.setValue({
                    fieldId: 'customform',
                    value: formHelper.getCategoryFormId(1, categoryId)
                });
                
                // Set the flag to true to indicate a script-initiated change
                scriptInitiatedChange = true;
            }

            if (context.fieldId === 'customform') {
                var formId = currentRecord.getValue({fieldId: 'class'});

                var formCategoryId = formHelper.getFormCategoryId(1, currentRecord.getValue({fieldId: 'class'}), currentRecord.getValue({fieldId: 'customform'}));

                currentRecord.setValue({
                    fieldId: 'class',
                    value: formCategoryId
                });

                // Set the flag to true to indicate a script-initiated change
                scriptInitiatedChange = true;
            }
        }
    }

    return {
        // TODO: Fix the infinitety loop later
        // fieldChanged: fieldChanged,
        // pageInit: pageInit
    };

});
