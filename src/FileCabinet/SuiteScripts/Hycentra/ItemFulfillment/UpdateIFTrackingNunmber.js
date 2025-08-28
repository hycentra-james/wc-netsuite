/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */

define(['N/record', 'N/log'], function(record, log) {

    function execute(context) {
        // CSV data: ID to Tracking Number mapping
        var fulfillmentTrackingData = [
            { id: 10398243, tracking: '883943918208' },
            { id: 10398247, tracking: '883947021466' },
            { id: 10398248, tracking: '883947044938' },
            { id: 10398249, tracking: '883947076290' },
            { id: 10398250, tracking: '883947126508' },
            { id: 10398251, tracking: '883947140074' },
            { id: 10398252, tracking: '883947170695' },
            { id: 10398253, tracking: '883947197739' },
            { id: 10398254, tracking: '883947206325' },
            { id: 10398255, tracking: '883947239588' },
            { id: 10398256, tracking: '883947242150' },
            { id: 10398257, tracking: '883947289799' },
            { id: 10398258, tracking: '883947221120' },
            { id: 10398259, tracking: '883947317222' },
            { id: 10398260, tracking: '883947339981' },
            { id: 10398261, tracking: '883947362740' },
            { id: 10398263, tracking: '883947400046' },
            { id: 10398264, tracking: '883947266673' },
            { id: 10398265, tracking: '883947413723' },
            { id: 10398266, tracking: '883947454907' },
            { id: 10398267, tracking: '883947482024' },
            { id: 10398268, tracking: '883947530442' },
            { id: 10398269, tracking: '883947510922' },
            { id: 10398270, tracking: '883947562702' },
            { id: 10398271, tracking: '883947586066' }
        ];

        log.audit('Bulk Tracking Update Started', 'Processing ' + fulfillmentTrackingData.length + ' Item Fulfillment records');

        var successCount = 0;
        var errorCount = 0;
        var errors = [];

        // Process each fulfillment record
        for (var i = 0; i < fulfillmentTrackingData.length; i++) {
            var data = fulfillmentTrackingData[i];
            
            try {
                log.debug('Processing Record', 'IF ID: ' + data.id + ', Tracking: ' + data.tracking);
                
                // Load the Item Fulfillment record
                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: data.id
                });
                
                // Get package count
                var packageCount = fulfillmentRecord.getLineCount({ sublistId: 'package' });
                log.debug('Package Info', 'IF ' + data.id + ' has ' + packageCount + ' packages');
                
                if (packageCount === 0) {
                    log.audit('No Packages', 'IF ' + data.id + ' has no packages - skipping');
                    continue;
                }
                
                // Update the first package tracking number
                fulfillmentRecord.setSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagetrackingnumber',
                    line: 0,
                    value: data.tracking
                });
                
                // Save the record
                var savedId = fulfillmentRecord.save();
                
                log.audit('Success', 'IF ' + data.id + ' updated with tracking: ' + data.tracking);
                successCount++;
                
            } catch (e) {
                errorCount++;
                var errorMsg = 'Error updating IF ' + data.id + ': ' + e.message;
                log.error('Update Error', errorMsg);
                errors.push({
                    id: data.id,
                    tracking: data.tracking,
                    error: e.message
                });
            }
        }

        // Final summary
        log.audit('Bulk Update Complete', {
            total: fulfillmentTrackingData.length,
            successful: successCount,
            errors: errorCount,
            errorDetails: errors
        });

        if (errorCount > 0) {
            log.error('Error Summary', 'Failed to update ' + errorCount + ' records. See error details above.');
        }
    }

    return {
        execute: execute
    };
});
