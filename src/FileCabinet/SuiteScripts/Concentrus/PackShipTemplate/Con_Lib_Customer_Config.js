/**
 * Centralized customer configuration & shipping unit preferences.
 * @NApiVersion 2.1
 */
define([], () => {
    const CUSTOMER = Object.freeze({
        LOWES_HOME_CENTERS_LLS: '275',
        THE_HOME_DEPOT_INC: '317',
        THE_HOME_DEPOT_SPECIAL_PRO: '12703'
    });

    const LOWES_IDS = new Set([CUSTOMER.LOWES_HOME_CENTERS_LLS]);
    const HOME_DEPOT_IDS = new Set([CUSTOMER.THE_HOME_DEPOT_INC, CUSTOMER.THE_HOME_DEPOT_SPECIAL_PRO]);

    const SHIPPING_UNIT_PREFERENCE = Object.freeze({
        BOXES_FIRST: 'BOXES_FIRST',
        PALLETS_FIRST: 'PALLETS_FIRST'
    });

    const isLowes = id => LOWES_IDS.has(String(id));
    const isHomeDepot = id => HOME_DEPOT_IDS.has(String(id));

    function getShippingUnitPreference(id) {
        return isLowes(id) ? SHIPPING_UNIT_PREFERENCE.BOXES_FIRST : SHIPPING_UNIT_PREFERENCE.PALLETS_FIRST;
    }

    return {
        CUSTOMER,
        LOWES_IDS,
        HOME_DEPOT_IDS,
        SHIPPING_UNIT_PREFERENCE,
        isLowes,
        isHomeDepot,
        getShippingUnitPreference
    };
});
