/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/log', 'N/record'], function(log, record) {
    
    /**
     * Function definition to be triggered before record is submitted.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @param {string} scriptContext.type - Trigger type
     * @Since 2015.2
     */
    function beforeSubmit(scriptContext) {
        try {
            // Run on both CREATE and EDIT to catch when the field gets populated
            if (scriptContext.type !== scriptContext.UserEventType.CREATE) {
                log.debug('Skipping execution', 'Script only runs on record creation or edit. Current type: ' + scriptContext.type);
                return;
            }
            
            var newRecord = scriptContext.newRecord;
            
            // Get sales order number for logging
            var salesOrderNumber = newRecord.getValue({
                fieldId: 'otherrefnum'
            }) || 'Unknown';
            
            log.debug('Processing Record', 'Sales Order: ' + salesOrderNumber + ' - Event Type: ' + scriptContext.type);
            
            // Check if Customer equals 317 (The Home Depot)
            var entityId = newRecord.getValue({
                fieldId: 'entity'
            });
            
            if (entityId != 317) {
                log.debug('Entity check failed', 'Sales Order: ' + salesOrderNumber + ' - Customer is ' + entityId + ', expected 317. Skipping execution.');
                return;
            }
            
            // Get the custom field value directly from newRecord (no need to reload)
            var sourcedDataField = newRecord.getValue({
                fieldId: 'custbody_lb_headerdata'
            });
            
            log.debug('Field Check', 'Sales Order: ' + salesOrderNumber + ' - custbody_lb_headerdata length: ' + (sourcedDataField ? sourcedDataField.length : 0));
            
            if (!sourcedDataField) {
                log.debug('No sourced data found', 'Sales Order: ' + salesOrderNumber + ' - custbody_lb_headerdata is empty');
                
                // Additional debugging - check if this is an imported order
                var createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
                var externalId = newRecord.getValue({ fieldId: 'externalid' });
                var lbOrderKey = newRecord.getValue({ fieldId: 'custbody_lb_orderlbkey' });
                
                log.debug('Order Source Debug', 'Sales Order: ' + salesOrderNumber + 
                    ' - CreatedFrom: ' + createdFrom + 
                    ', ExternalId: ' + externalId + 
                    ', LB OrderKey: ' + lbOrderKey);
                
                return;
            }
            
            // Parse the JSON
            var sourcedData;
            try {
                sourcedData = JSON.parse(sourcedDataField);
            } catch (parseError) {
                log.error('JSON Parse Error', 'Sales Order: ' + salesOrderNumber + ' - Failed to parse custbody_lb_headerdata: ' + parseError.message);
                return;
            }
            
            log.debug('JSON Parsed', 'Sales Order: ' + salesOrderNumber + ' - Warehouse: ' + (sourcedData.packSlipFields ? sourcedData.packSlipFields.Warehouse : 'Not found'));
            
            // Check if warehouse is "CA Ontario"
            if (sourcedData.packSlipFields && sourcedData.packSlipFields.Warehouse &&
                sourcedData.packSlipFields.Warehouse === "CA Ontario") {
                
                log.debug('All conditions met', 'Sales Order: ' + salesOrderNumber + ' - Entity=317, Warehouse=CA Ontario. Updating shipping fields.');
                
                // Update ShipVia in packSlipFields
                sourcedData.packSlipFields.ShipVia = "MCC";
                
                // Update lineHaul and serviceLevel in shippingLabelFields
                if (!sourcedData.shippingLabelFields) {
                    sourcedData.shippingLabelFields = {};
                }
                
                sourcedData.shippingLabelFields.lineHaul = "MCC";
                sourcedData.shippingLabelFields.serviceLevel = "UNSP";
                
                // Convert back to JSON string
                var updatedJsonString = JSON.stringify(sourcedData);

                log.debug('Updated JSON String', 'Sales Order: ' + salesOrderNumber + ' - ' + updatedJsonString);
                
                // Update the field directly on newRecord (this will be saved automatically)
                newRecord.setValue({
                    fieldId: 'custbody_lb_headerdata',
                    value: updatedJsonString
                });
                
                log.debug('Fields Updated', 'Sales Order: ' + salesOrderNumber + ' - Successfully updated ShipVia=MCC, lineHaul=MCC, serviceLevel=UNSP');
            } else {
                var currentWarehouse = (sourcedData.packSlipFields && sourcedData.packSlipFields.Warehouse) ? sourcedData.packSlipFields.Warehouse : 'Not found';
                log.debug('Warehouse check failed', 'Sales Order: ' + salesOrderNumber + ' - Current warehouse: ' + currentWarehouse + ', expected "CA Ontario"');
            }
            
        } catch (error) {
            log.error('UserEvent Error', 'Error in beforeSubmit: ' + error.message);
        }
    }
    
    return {
        beforeSubmit: beforeSubmit
    };
}); 