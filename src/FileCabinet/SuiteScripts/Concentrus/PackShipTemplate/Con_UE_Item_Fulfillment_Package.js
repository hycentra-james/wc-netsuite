/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'SuiteScripts/Concentrus/PackShipTemplate/Con_Lib_Item_Fulfillment_Package.js'],
    function (record, search, itemFulfillmentPackage) {

        function beforeSubmit(context) {
            log.debug('context.type', context.type)
            if (context.type !== context.UserEventType.EDIT
                && context.type !== context.UserEventType.SHIP
                // && context.type !== context.UserEventType.PACK
            ) {
                return;
            }
            let newRecord = context.newRecord;
            let oldRecord = context.oldRecord;

            // Get current and previous status
            let currentStatus = newRecord.getText('shipstatus');
            let previousStatus = oldRecord ? oldRecord.getText('shipstatus') : null;

            let shipMethod = newRecord.getValue('shipmethod');
            log.debug('record', {currentStatus, previousStatus, shipMethod})

            if (!shipMethod) {
                log.debug('Ship Method', 'No ship method found on item fulfillment');
                return;
            }

            let shipMethodId = shipMethod.toString();

            if (itemFulfillmentPackage.getLtlShipMethodIds().indexOf(shipMethodId) !== -1 && currentStatus === 'Shipped') {
                let recordToEdit = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: newRecord.id
                });
                let salesOrderId = recordToEdit.getValue({
                    fieldId: 'createdfrom'
                })
                let soLookup = search.lookupFields({
                    type: 'salesorder',
                    id: salesOrderId,
                    columns: ['custbody_pro_number']
                })
                let proNumber = soLookup.custbody_pro_number
                log.debug('proNumber', proNumber)
                if (proNumber == "") {
                    throw new Error('PRO Number is required for LTL shipment');
                }
            }
        }

        function afterSubmit(context) {
            log.debug('context.type', context.type)
            if (context.type !== context.UserEventType.EDIT
                && context.type !== context.UserEventType.CREATE
                && context.type !== context.UserEventType.SHIP
                // && context.type !== context.UserEventType.PACK
            ) {
                return;
            }

            let newRecord = context.newRecord;
            let oldRecord = context.oldRecord;

            // Get current and previous status
            let currentStatus = newRecord.getText('shipstatus');
            let previousStatus = oldRecord ? oldRecord.getText('shipstatus') : null;

            // Get ship method
            let shipMethod = newRecord.getValue('shipmethod');
            log.debug('record', {statusChange: `${currentStatus} -> ${previousStatus}`, shipMethod})

            if (!shipMethod) {
                log.debug('Ship Method', 'No ship method found on item fulfillment');
                return;
            }

            let shipMethodId = shipMethod.toString();

            if (currentStatus === 'Shipped' && previousStatus !== 'Shipped') {
                itemFulfillmentPackage.processFullSmallParcel(newRecord.id, shipMethodId);
                itemFulfillmentPackage.processFullLtl(newRecord.id, shipMethodId);
            }
        }

        function safelyExecute(func, context) {
            try {
                return func(context)
            } catch (e) {
                log.error(`error in ${func.name}`, e.toString())
            }
        }

        return {
            beforeSubmit,
            afterSubmit: (context) => safelyExecute(afterSubmit, context),
        }
    })

