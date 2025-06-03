/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */

define(['N/record', 'N/search'],
    function(record, search) {
        // This field change function is used for Showroom customer who entered their address 
        // but picking up should use CA_SAN BERNARDINO__ONTARIO_ZQEZ_XM6F tax code instead
        function fieldChanged(context) {
            if (context.fieldId === 'shipmethod'){
                var currentRecord = context.currentRecord;
    
                // Get the value of the shipmethod field
                var shipMethod = currentRecord.getValue({
                    fieldId: 'shipmethod'
                });
    
                // Check if shipmethod is 'Pick Up'
                if (shipMethod === '32') {    // 32 = Pick Up
                    // Get line count
                    var lineCount = currentRecord.getLineCount({
                        sublistId: 'item'
                    });
    
                    // Loop through each line item and set the tax code
                    for (var i = 0; i < lineCount; i++) {
                        currentRecord.selectLine({
                            sublistId: 'item',
                            line: i
                        });

                        // Set the tax code for the line item
                        currentRecord.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'taxcode',
                            value: -1842, // -1842 = CA_SAN BERNARDINO__ONTARIO_ZQEZ_XM6F
                            forceSyncSourcing: true
                        });
    
                        currentRecord.commitLine({ sublistId: 'item' });
                    }
                }

            }
        }

        return {
            fieldChanged: fieldChanged
        };

    });
