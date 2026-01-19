/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Item Fulfillment UE to add Print Template buttons.
 */

define(['N/record', 'N/runtime', 'N/url'], (record, runtime, url) => {
  const CUSTOMER = Object.freeze({
    THE_HOME_DEPOT_INC: '317',
    THE_HOME_DEPOT_SPECIAL_PRO: '12703',
    LOWES_HOME_CENTERS_LLS: '275'
  });
  const CUSTOMER_IDS = new Set(Object.values(CUSTOMER));
  const FIELD_PRO_NUMBER = 'custbody_pro_number';

  function beforeLoad(context) {
    try {
      if (context.type !== context.UserEventType.VIEW) return;
      const form = context.form;
      const fulfillment = context.newRecord;
      const createdFrom = fulfillment.getValue('createdfrom');
      if (!createdFrom) return;

      // Load sales order to get customer and pro number
      let so;
      try { so = record.load({ type: record.Type.SALES_ORDER, id: createdFrom, isDynamic: false }); } catch (e) { log.error({ title: '' + e.name, details: `Error Message: ${e.message} | Error Stack: ${e.stack}` }); return; }
      const fulfillRec = fulfillment;
      const customerId = (so.getValue('entity') || '').toString();
      const copies = (customerId === CUSTOMER.LOWES_HOME_CENTERS_LLS ? so.getValue('custitem_fmt_no_boxex') :
      so.getValue('custitem_fmt_pallet_quantity'))|| 1; // Default to 1 if not set
      const firstItemId = so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: 0 }) || '';
      const addressType = so.getValue('custbody_hyc_address_type');
      const shippingMethod = fulfillment.getValue('shipmethod') || '';

      const proNumber = so.getValue(FIELD_PRO_NUMBER);

      // Attach client script (same folder)
      form.clientScriptModulePath = './Con_CS_PackShip_Print_Popup.js';
      if (!proNumber) {
        form.addButton({
          id: 'custpage_con_ps_enter_pro',
          label: 'Update SO Pro Number',
          functionName: 'conPsEnterPro' // implemented in client script
        });
      }

      if(CUSTOMER_IDS.has(customerId) && proNumber){
        // Add the four buttons
        form.addButton({ id: 'custpage_con_ps_print_all', label: 'Print All', functionName: 'conPsPrintAll' });
        form.addButton({ id: 'custpage_con_ps_print_bol', label: 'Print BOL', functionName: 'conPsPrintBOL(1)' });
        form.addButton({ id: 'custpage_con_ps_print_ucc', label: 'Print UCC', functionName: 'conPsPrintUCC' });
        // form.addButton({ id: 'custpage_con_ps_print_pack', label: 'Print Packing Slip', functionName: 'conPsPrintPackSlip' });
        form.addButton({ id: 'custpage_con_ps_print_pack', label: 'Print Packing Slip', functionName: 'printPackingSlipWithApi' });
      }

      // print fedex label by printer, for testing purpose only
      // copy from Con_UE_Update_SSCC_Number.js
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
      const upsRelatedMethod = [
        '4',    // UPS Ground
        '40',   // UPS Ground (WC)
        '41',   // UPS Next Day Air
        '43',   // UPS 2nd Day Air
        '3776', // UPS 3 Day Select
        '3777', // UPS Next Day Air Early
        '3778', // UPS Next Day Air Saver
        '3779', // UPS 2nd Day Air A.M.
        '3780', // UPS Ground Freight
        '8988'  // UPS SurePost
      ];
      const shipMethodId = fulfillRec.getValue({ fieldId: 'shipmethod' });
      if( fedexRelatedMethod.includes(shipMethodId)) { // FedEx Ground internal id
        form.addButton({
          id: 'custpage_con_ps_print_fedex',
          label: 'Print FedEx Label',
          functionName: 'conPsPrintSmallParcelLabel'
        });

        // Add Re-create Shipment button for FedEx ship methods
        form.addButton({
          id: 'custpage_con_ps_recreate_shipment',
          label: 'Re-create Shipment',
          functionName: 'conPsRecreateShipment'
        });

        // Add Retry Label Download button if there are failed label downloads
        const originalLabelUrl = fulfillRec.getValue({ fieldId: 'custbody_original_label_url' });
        if (originalLabelUrl) {
          form.addButton({
            id: 'custpage_con_ps_retry_label',
            label: 'Retry Label Download',
            functionName: 'conPsRetryLabelDownload'
          });
        }
      }

      // UPS-related buttons
      if (upsRelatedMethod.includes(shipMethodId)) {
        form.addButton({
          id: 'custpage_con_ps_print_ups',
          label: 'Print UPS Label',
          functionName: 'conPsPrintSmallParcelLabel'
        });

        form.addButton({
          id: 'custpage_con_ps_recreate_ups_shipment',
          label: 'Re-create Shipment',
          functionName: 'conPsRecreateUPSShipment'
        });
      }

      // Pass context data to client via hidden fields (added only if not existing)
      addHiddenField(form, 'custpage_con_ps_soid', createdFrom);
      addHiddenField(form, 'custpage_con_ps_ifid', fulfillment.id);
      addHiddenField(form, 'custpage_con_ps_customer', customerId);
      addHiddenField(form, 'custpage_con_ps_shipmethod', shippingMethod);
      addHiddenField(form, 'custpage_con_ps_copies', copies);
      addHiddenField(form, 'custpage_con_ps_first_itemid', firstItemId);
      addHiddenField(form, 'custpage_con_ps_address_type', addressType);
    } catch (error) {
      log.error({ title: '' + error.name, details: `Error Message: ${error.message} | Error Stack: ${error.stack}`});
    }
  }

  function addHiddenField(form, id, value) {
    if (!form.getField({ id })) {
      const fld = form.addField({ id, label: id, type: 'inlinehtml' });
      fld.defaultValue = `<input type="hidden" id="${id}" value="${value || ''}" />`;
    }
  }

  return { beforeLoad: beforeLoad };
});
