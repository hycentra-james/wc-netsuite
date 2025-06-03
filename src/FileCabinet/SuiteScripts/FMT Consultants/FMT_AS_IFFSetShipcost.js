/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */


define(['N/record', 'N/runtime', 'N/search'],

    function (record, runtime, search) {
        function updateSalesorder(scriptContext) {
            var id = scriptContext.newRecord.id;
            var type = scriptContext.newRecord.type;
            var rec = record.load({type: type, id: id});
            var createdFrom = rec.getValue({fieldId: "createdfrom"});
            var shipCost, soRec, tranType, soSearchValues;

            log.debug('createdfrom', createdFrom);

            try {
                shipCost = rec.getValue({fieldId: "custbody_fmt_actual_shipping_cost"});
                log.debug('shipCost', shipCost);
                tranType = search.lookupFields({type: "transaction", id: createdFrom, columns: ['type']});

                log.debug('tranType', JSON.stringify(tranType));
                if (tranType.type[0].value == "SalesOrd") {
                    soSearchValues = search.lookupFields({
                        type: "salesorder",
                        id: createdFrom,
                        columns: ['custbody_fmt_actual_shipping_cost']
                    });
                    log.debug('soSearchValues.custbody_fmt_actual_shipping_cost.', soSearchValues.custbody_fmt_actual_shipping_cost);

                    if (!soSearchValues.custbody_fmt_actual_shipping_cost) {
                        log.debug('Setting Actual Shipping Cost.');
                        record.submitFields({
                            type: "salesorder",
                            id: createdFrom,
                            values: {'custbody_fmt_actual_shipping_cost': shipCost}
                        });
                    }
                }
            } catch (ex) {

            }
        }

        return {
            onAction: updateSalesorder
        }
    })