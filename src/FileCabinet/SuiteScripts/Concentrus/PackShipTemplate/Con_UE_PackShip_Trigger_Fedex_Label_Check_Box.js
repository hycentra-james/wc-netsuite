/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * attached on customrecord_packship_cartonitem, only trigger on record created
 * get it's parent record customrecord_packship_carton by field 'custrecord_packship_carton' on it
 * and customrecord_packship_carton's parent by field 'custrecord_packship_shipmentid' on the customrecord_packship_carton
 * then get all customrecord_packship_carton under this customrecord_packship_shipment
 * check if all customrecord_packship_carton has customrecord_packship_carton under it(search customrecord_packship_carton by field 'custrecord_packship_carton' on it)
 * this is the logic to check if all carton item has been created
 * (Updated) Trigger logic (2025-08): execute actions ONLY when the LAST packed item (carton item) is created.
 * New completeness method (replaces package/carton-name matching):
 *   - Load related Item Fulfillment, iterate the 'item' sublist.
 *   - For each line with itemtype = 'InvtPart', accumulate required quantity (field 'itemquantity') by item internal id.
 *   - Aggregate packed quantities from all carton item records (customrecord_packship_cartonitem) linked to the same IF:
 *       * Item field: 'custrecord_packship_fulfillmentitem'
 *       * Quantity field: 'custrecord_packship_totalpackedqty'
 *   - Treat kit components individually (already expanded on IF), so only compare inventory part items.
 *   - When for every required item the summed packed qty >= required qty, the current carton item is deemed the LAST packed item.
 * On completion:
 *   - Set Item Fulfillment checkbox 'custbody_con_packed_item_ready' = true (idempotent).
 *   - Invoke FedEx or UPS shipment creation & label print (when shipmethod is FedEx or UPS related).
 * get the itemfulfillment id by field 'custrecord_packship_itemfulfillment'on customrecord_packship_cartonitem
 * assume all customrecord_packship_cartonitem under a shipment would under the same itemfulfillment record
 */
define(['N/record','N/search','N/log', '../../Hycentra/Integrations/FedEX/fedexHelper', '../../Hycentra/Integrations/UPS/upsHelper', './Con_Lib_Print_Node','./Con_Lib_Item_Fulfillment_Package'],
    (record, search, log, fedexHelper, upsHelper, printNodeLib, itemFulfillmentPackageHelper) => {
        // Constants (field & record IDs)
        const REC_CARTON_ITEM = 'customrecord_packship_cartonitem';
        const REC_CARTON = 'customrecord_packship_carton';
        const FIELD_PARENT_CARTON = 'custrecord_packship_carton'; // on carton item -> carton
        const FIELD_SHIPMENT = 'custrecord_packship_shipmentid'; // on carton -> shipment
        const FIELD_ITEM_FULFILLMENT = 'custrecord_packship_itemfulfillment'; // on carton item -> IF

        const beforeLoad = () => {};
        const beforeSubmit = () => {};

    /**
     * afterSubmit (CREATE): Execute only when current carton item makes the shipment COMPLETE (last packed item).
     * Completion definition: every carton (name) for the shipment is represented in the Item Fulfillment 'package' sublist (field packagedescr).
     */
        const afterSubmit = (ctx) => {
            // Start execution timer for performance profiling
            var startTime = Date.now();
            log.debug('PERFORMANCE', 'afterSubmit()::Execution started at ' + new Date(startTime).toISOString());
            
            try {
                log.debug('Triggered', `at ${new Date()} | id ${ctx.newRecord.id}`)
                if (ctx.type !== ctx.UserEventType.CREATE) return; // only on create
                const newRec = ctx.newRecord;
                if (!newRec || newRec.type !== REC_CARTON_ITEM) return;

                const cartonId = newRec.getValue({ fieldId: FIELD_PARENT_CARTON });
                const itemFulfillmentId = newRec.getValue({ fieldId: FIELD_ITEM_FULFILLMENT });
                if (!cartonId || !itemFulfillmentId) {
                    log.debug('Skip - missing cartonId or itemFulfillmentId', { cartonId, itemFulfillmentId });
                    return;
                }


                // Lookup shipment id from carton
                const cartonShipmentLookup = search.lookupFields({
                    type: REC_CARTON,
                    id: cartonId,
                    columns: [FIELD_SHIPMENT]
                });
                const shipmentId = cartonShipmentLookup && cartonShipmentLookup[FIELD_SHIPMENT] ? cartonShipmentLookup[FIELD_SHIPMENT][0]?.value || cartonShipmentLookup[FIELD_SHIPMENT] : '';
                if (!shipmentId) {
                    log.debug('Skip - no shipmentId on carton', { cartonId });
                    return;
                }

                // New completeness logic (item quantity based):
                // 1. Load IF and build required quantity map for inventory part lines.
                const ifId = itemFulfillmentId;
                let fulfillRec = record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId, isDynamic: false });
                const lineCount = fulfillRec.getLineCount({ sublistId: 'item' });
                const requiredMap = {}; // itemId -> total required qty
                for (let i=0; i<lineCount; i++) {
                    const itemId = fulfillRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                    const qty = Number(fulfillRec.getSublistValue({ sublistId: 'item', fieldId: 'itemquantity', line: i })) || 0;
                    const itemType = fulfillRec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                    // Only consider inventory part (InvtPart) lines per spec; assume components already present individually.
                    if (itemType === 'InvtPart' && itemId && qty > 0) {
                        requiredMap[itemId] = (requiredMap[itemId] || 0) + qty;
                    }
                }
                if (Object.keys(requiredMap).length === 0) {
                    log.debug('No qualifying inventory part lines on IF; skip completeness logic');
                    return;
                }

                // 2. Aggregate packed quantities from carton item (packed item) records for this IF.
                //    Fields: custrecord_packship_fulfillmentitem (item), custrecord_packship_totalpackedqty (qty)
                //    (Updated) Removed summary search due to field limitations; retrieve raw rows and aggregate in JS.
                const FIELD_PACKED_ITEM = 'custrecord_packship_fulfillmentitem';
                const FIELD_PACKED_QTY = 'custrecord_packship_totalpackedqty';
                const packedMap = {}; // itemId -> total packed qty
                const packedSearch = search.create({
                    type: REC_CARTON_ITEM,
                    filters: [ [ FIELD_ITEM_FULFILLMENT, 'anyof', ifId ], 'AND', [ FIELD_PACKED_ITEM, 'noneof', '@NONE@' ] ],
                    columns: [
                        search.createColumn({ name: FIELD_PACKED_QTY, label: 'Total Packed Quantity' }),
                        search.createColumn({ name: FIELD_PACKED_ITEM, label: 'Item' })
                    ]
                });
                packedSearch.run().each(res => {
                    const itemIdRaw = res.getValue({ name: FIELD_PACKED_ITEM });
                    const qtyRaw = res.getValue({ name: FIELD_PACKED_QTY });
                    const itemId = itemIdRaw || '';
                    const qty = Number(qtyRaw) || 0;
                    if (itemId) {
                        packedMap[itemId] = (packedMap[itemId] || 0) + qty;
                    }
                    return true;
                });

                // 3. Compare required vs packed; determine completeness.
                const incompleteItems = [];
                Object.keys(requiredMap).forEach(itemId => {
                    const required = requiredMap[itemId] || 0;
                    const packed = packedMap[itemId] || 0;
                    if (packed < required) {
                        incompleteItems.push({ itemId, required, packed });
                    }
                });
                if (incompleteItems.length) {
                    log.debug('Not complete yet - some items not fully packed', { incompleteItems });
                    return; // wait for more carton items
                }

                log.debug('All required inventory part quantities fully packed -> last packed item reached', { ifId });

                // 4. Mark IF packed item ready (idempotent)
                const PACKED_READY_FIELD = 'custbody_con_packed_item_ready';
                const alreadyReady = fulfillRec.getValue({ fieldId: PACKED_READY_FIELD });
                if (!alreadyReady) {
                    record.submitFields({
                        type: record.Type.ITEM_FULFILLMENT,
                        id: ifId,
                        values: { [PACKED_READY_FIELD]: true }
                    });
                    log.debug('Item Fulfillment marked packed item ready', { ifId });
                } else {
                    log.debug('Item Fulfillment already marked packed item ready', { ifId });
                }

                // 5. FedEx/UPS logic & printing
                let shipMethodId = fulfillRec.getValue({ fieldId: 'shipmethod' });

                const fedexRelatedMethod = [
                        '3', // FedEx 2Day
                        '15', // FedEx 2Day A.M.
                        '16', // FedEx Express Saver
                        '3783', // FedEx Express Saver® WC
                        '17', // FedEx First Overnight
                        '19', // FedEx Ground (SC)
                        '20', // FedEx Home Delivery (SC)
                        '22', // FedEx Priority Overnight
                        '3785', // FedEx Priority Overnight® WC
                        '23', // FedEx Standard Overnight
                        '3784', // FedEx Standard Overnight® WC
                        '14075' //FedEx One Rate - PAK
                ];

                const upsRelatedMethod = [
                        '4',    // UPS Ground
                        '40',   // UPS Ground (WC)
                        '41',   // UPS Next Day Air
                        '43',   // UPS Next Day Air Saver
                        '3776', // UPS SurePost
                        '3777', // UPS SurePost 1lb+
                        '3778', // UPS 2nd Day Air
                        '3779', // UPS 3 Day Select
                        '3780', // UPS Next Day Air Early
                        '8988'  // UPS 2nd Day Air A.M.
                ];

                if (fedexRelatedMethod.includes(shipMethodId)) {
                        itemFulfillmentPackageHelper.processFullSmallParcel(fulfillRec.id, shipMethodId);
                        fulfillRec = record.load({
                            type: record.Type.ITEM_FULFILLMENT,
                            id: ifId,
                            isDynamic: false
                        });
                        fedexHelper.createShipment(fulfillRec, false);
                        // Printing labels have been moved to fedexHelper.js for optimization purpose
                } else if (upsRelatedMethod.includes(shipMethodId)) {
                        itemFulfillmentPackageHelper.processFullSmallParcel(fulfillRec.id, shipMethodId);
                        fulfillRec = record.load({
                            type: record.Type.ITEM_FULFILLMENT,
                            id: ifId,
                            isDynamic: false
                        });
                        upsHelper.createShipment(fulfillRec, false);
                        // UPS label printing handled in upsHelper.js
                } else {
                        log.debug({ title: 'Auto Print Skip', details: 'Ship method is not FedEx or UPS (id=' + shipMethodId + ')' });
                }

                // Calculate and log execution time - SUCCESS case
                var endTime = Date.now();
                var executionTime = endTime - startTime;
                log.debug('PERFORMANCE', 'afterSubmit()::Execution completed successfully in ' + executionTime + 'ms (' + (executionTime / 1000).toFixed(2) + ' seconds)');

            } catch (e) {
                // Calculate and log execution time - ERROR case
                var endTime = Date.now();
                var executionTime = endTime - startTime;
                log.error('PERFORMANCE', 'afterSubmit()::Execution failed after ' + executionTime + 'ms (' + (executionTime / 1000).toFixed(2) + ' seconds)');
                
                log.error('afterSubmit failure', e);
            }
        };

        return { beforeLoad, beforeSubmit, afterSubmit };
    });
