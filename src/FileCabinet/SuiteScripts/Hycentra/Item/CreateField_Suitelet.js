/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/log', 'N/redirect', 'N/record'], function(ui, log, redirect, record) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            var form = ui.createForm({
                title: 'Create Custom Fields'
            });

            form.addSubmitButton({
                label: 'Create Fields'
            });

            context.response.writePage(form);
        } else {
            try {
                // Call the function to create custom fields
                execute();
                context.response.write('Custom fields created successfully.');
            } catch (e) {
                log.error('Error creating custom fields', e);
                context.response.write('Error: ' + e.message);
            }
        }
    }

    function execute() {
        // Define the categories and fields to create
        var labels = ['Backsplash California Pro65 Chemicals Disclosure','Backsplash California Pro65 (Y/N)','Cabinet Hardware Pro65 Chemicals Disclosure','Cabinet Hardware California Pro65 (Y/N)','Faucet California Pro65 Chemicals Disclosure','Faucet California Pro65 (Y/N)','Mirror California Pro65 Chemicals Disclosure','Mirror California Pro65 (Y/N)'];
        var fieldIds = ['bs_cali65', 'bs_cali65_yn', 'cab_hw_cali65', 'cab_hw_cali65_yn', 'faucet_cali65', 'faucet_cali65_yn', 'mirror_cali65', 'mirror_cali65_yn'];

        // Loop through each category and field to create the custom fields
        labels.forEach(function(label) {
            fieldIds.forEach(function(fieldId) {
                createCustomField(label, fieldId);
            });
        });
    }

    function createCustomField(label, fieldId) {
        try {
            var fieldId = '_hyc_' + fieldId.toLowerCase();
            var fieldLabel = label;

            var customField = record.create({
                type: record.Type.ITEM_FIELD
            });

            customField.setValue({
                fieldId: 'label',
                value: fieldLabel
            });

            customField.setValue({
                fieldId: 'id',
                value: fieldId
            });

            customField.setValue({
                fieldId: 'type',
                //value: record.FieldType.DECIMAL_NUMBER
                value: record.FieldType.TEXT
            });

            customField.setValue({
                fieldId: 'appliesto',
                value: 'KITITEM'
            });

            var fieldId = customField.save();
            log.debug('Custom field created', 'Field ID: ' + fieldId);

        } catch (e) {
            log.error('Error creating custom field', e);
        }
    }

    return {
        onRequest: onRequest
    };
});