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
 * (Updated) Trigger logic: execute actions ONLY when the LAST packed item (carton item) is created.
 * New completeness method:
 *   - Load related Item Fulfillment and iterate its 'package' sublist.
 *   - Collect all values of field 'packagedescr'.
 *   - Collect all carton record names under the same shipment.
 *   - If every carton name is present within the package description set (case-sensitive match), current carton item creation is the last one.
 * When last one: update Item Fulfillment checkbox 'custbody_con_packed_item_ready' = true and invoke FedEx shipment logic (if ship method qualifies).
 * get the itemfulfillment id by field 'custrecord_packship_itemfulfillment'on customrecord_packship_cartonitem
 * assume all customrecord_packship_cartonitem under a shipment would under the same itemfulfillment record
 */
define(['N/record','N/search','N/log','../../Hycentra/Integrations/FedEX/fedexHelper'],
    (record, search, log, fedexHelper) => {

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

                // 1. Gather all carton IDs & names under this shipment
                const allCartons = [];
                search.create({
                    type: REC_CARTON,
                    filters: [ [ FIELD_SHIPMENT, 'anyof', shipmentId ] ],
                    columns: ['internalid','name']
                }).run().each(r => { allCartons.push({ id: r.getValue('internalid'), name: r.getValue('name') }); return true; });
                if (!allCartons.length) {
                    log.debug('No cartons under shipment; nothing to do', { shipmentId });
                    return;
                }

                // 2. Load IF & collect package sublist packagedescr values
                const ifId = itemFulfillmentId;
                const fulfillRec = record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId, isDynamic: false });
                const packageLineCount = fulfillRec.getLineCount({ sublistId: 'package' });
                const packageDescrSet = new Set();
                for (let i=0;i<packageLineCount;i++) {
                    const descr = fulfillRec.getSublistValue({ sublistId: 'package', fieldId: 'packagedescr', line: i });
                    if (descr) packageDescrSet.add(descr.trim());
                }
                log.debug('packageDescrSet', Array.from(packageDescrSet));

                // 3. Determine completeness USING PACKAGE SUBLIST AS AUTHORITATIVE:
                //    Every package description must have a corresponding carton name.
                const cartonNameSet = new Set(allCartons.map(c => (c.name||'').trim()).filter(n=>n));
                if (packageDescrSet.size === 0) {
                    log.debug('No package lines yet, cannot be complete', { shipmentId });
                    return;
                }
                //log for each source list
                log.debug('cartonNameSet', Array.from(cartonNameSet));
                log.debug('packageDescrSet', Array.from(packageDescrSet));
                const missingPackages = Array.from(packageDescrSet).filter(pkgName => pkgName && !cartonNameSet.has(pkgName.trim()));
                if (missingPackages.length) {
                    log.debug('Not last carton item yet - some package descriptions lack matching carton records', { shipmentId, missingPackages });
                    return; // not complete yet
                }

                log.debug('All package descriptions have matching carton records -> last packed item reached', { shipmentId, cartonItemId: newRec.id });

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
                    '3784' // FedEx Standard Overnight® WC
            ];
            const shipMethodId = fulfillRec.getValue({ fieldId: 'shipmethod' });
            if (fedexRelatedMethod.includes(shipMethodId)) { // FedEx Ground internal id
                    log.debug("steven test2", "call fedex api");
                    fedexHelper.createShipment(fulfillRec, false); // assume returns label URL or object
                    record.submitFields({
                            type: record.Type.ITEM_FULFILLMENT,
                            id: ifId,
                            values: {
                                    'custbody_con_print_fedex_label': true
                            }
                    });
                    //after this call, it would pull the label into file cabinet sync
                    //use another block to print the label
            } else {
                    log.debug({ title: 'FedEx Auto Print Skip', details: 'Ship method not FedEx Ground on transition to Packed (id=' + shipMethodId + ')' });
            }

            } catch (e) {
                log.error('afterSubmit failure', e);
            }
        };

        return { beforeLoad, beforeSubmit, afterSubmit };
    });
