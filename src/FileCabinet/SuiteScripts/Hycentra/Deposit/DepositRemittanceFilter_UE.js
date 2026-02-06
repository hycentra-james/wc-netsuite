/**
 * DepositRemittanceFilter_UE.js
 * Adds a Remittance Number filter field and button to the Deposit record
 * so accounting can quickly select payments from a specific Shopify payout.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget'],
    (serverWidget) => {

        const beforeLoad = (context) => {
            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            const form = context.form;

            // Add the remittance number filter field
            const filterField = form.addField({
                id: 'custpage_remittance_filter',
                type: serverWidget.FieldType.TEXT,
                label: 'Remittance Number (Select by Remittance)'
            });

            // Attach client script
            form.clientScriptModulePath = './DepositRemittanceFilter_CS.js';
        };

        return { beforeLoad };
    });
