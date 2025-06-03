/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/search', 'N/ui/serverWidget'], function (search, serverWidget) {

    function onRequest(context) {
        // Only run on GET request
        if (context.request.method === 'GET') {
            /*
            // Load the saved search
            var mySearch = search.load({ id: 1714 });

            /*
            var fieldsToRemove = [
                'custitem_hyc_ab100_yn',
                'custitem_hyc_ab1953_yn',
                'custitem_fmt_adjustable_shelves',
                'custitem_fmt_any_adjustable_spout',
                'custitem_fmt_backsplash_included',
                'custitem_fmt_cabinet_door_self_close',
                'custitem_fmt_soft_close_door_hinges',
                'custitem_hyc_cartridge_included',
                'custitem_hyc_cupc_yn',
                'custitem_fmt_deck_plate_included',
                'custitem_fmt_diverter_included',
                'custitem_fmt_drain_assembly_included',
                'custitem_hyc_glass_magnifying',
                'custitem_fmt_glass_panel_door',
                'custitem_hyc_lighting_included',
                'custitem_fmt_low_lead_compliant',
                'custitem_hyc_mirror_framed_yn',
                'custitem_hyc_nsf_yn',
                'custitem_fmt_overflow_hole_included',
                'custitem_fmt_storage_included',
                'custitem_hyc_basin_depth',
                'custitem_hyc_basin_depth',
                'custitem_hyc_basin_length',
                'custitem_hyc_basin_length',
                'custitem_hyc_basin_width',
                'custitem_hyc_basin_width',
                'custitem_hyc_cabinet_int_depth',
                'custitem_hyc_cabinet_int_height',
                'custitem_hyc_cabinet_int_width',
                'custitem_fmt_sink_volume',
                'custitem_hyc_sink_weight',
                'custitem_hyc_counter_top_weight',
                'custitem_hyc_countertop_sink_wgt',
                'custitem_hyc_ptrap_av_depth',
                'custitem_hyc_ptrap_av_height',
                'custitem_hyc_ptrap_av_weight',
                'custitem_hyc_ptrap_av_width',
                'custitem_hyc_ptrap_depth',
                'custitem_hyc_ptrap_height',
                'custitem_hyc_ptrap_line_depth',
                'custitem_hyc_ptrap_line_height',
                'custitem_hyc_ptrap_line_weight',
                'custitem_hyc_ptrap_line_width',
                'custitem_hyc_ptrap_weight',
                'custitem_hyc_ptrap_width',
                'custitem_vanity_item_depth',
                'custitem_fmt_item_length',
                'custitem_vanity_item_height',
                'custitem_fmt_item_height',
                'custitem_hyc_vanity_item_weight',
                'custitem_wc_item_weight',
                'custitem_vanity_item_width',
                'custitem_fmt_item_width',
                'custitem_fmt_sink_volume',
                'custitem_fmt_box_length',
                'custitem_fmt_box_height',
                'custitem_fmt_box_weight',
                'custitem_fmt_box_width',
                'custitem_fmt_weight_capacity',
                'custitem_fmt_number_of_cabinet_doors',
                'custitem_fmt_number_of_decorative_draw',
                'custitem_fmt_number_of_decorative_draw',
                'custitem_fmt_number_of_cabinet_doors',
                'custitem_fmt_number_of_flip_out_front',
                'custitem_fmt_number_of_cabinet_doors',
                'custitem_lc_num_functional_cabinets',
                'custitem_hyc_num_of_regular_drawer',
                'custitem_fmt_number_of_installation',
                'custitem_fmt_number_of_knobs',
                'custitem_fmt_number_of_legs',
                'custitem_fmt_number_of_pre_drilled_h',
                'custitem_fmt_number_of_pre_drilled_h',
                'custitem_fmt_number_of_pulls',
                'custitem_fmt_number_of_shelves',
                'custitem_fmt_number_of_shelves',
                'custitem_fmt_adjustable_feet',
                'custitem_fmt_adjustable_feet_max_h',
                'custitem_fmt_adjustable_shelves',
                'custitem_hyc_assembly_required',
                'custitem_fmt_vanity_assembly_required',
                'custitem_backsplash_edge',
                'custitem_hyc_backsplash_finish',
                'custitem_fmt_backsplash_height',
                'custitem_fmt_backsplash_height',
                'custitem_fmt_backsplash_included',
                'custitem_fmt_backsplash_length',
                'custitem_hyc_backsplash_material',
                'custitem_backsplash_purchasable',
                'custitem_fmt_backsplash_thickness',
                'custitem_fmt_backsplash_thickness',
                'custitem_fmt_color',
                'custitem_hyc_cabinet_color_group',
                'custitem_fmt_cabinet_depth',
                'custitem_fmt_cabinet_finish',
                'custitem_hyc_cabinet_hw_finish',
                'custitem_fmt_cabinet_height',
                'custitem_vanity_mounting_type',
                'custitem_hyc_cabinet_struct_frame_mat',
                'custitem_fmt_cabinet_width',
                'custitem_fmt_compatible_sidesplash_sku',
                'custitem_fmt_sink_location',
                'custitem_fmt_sink_material',
                'custitem_vanity_sink_material',
                'custitem_vanity_sink_part',
                'custitem_vanity_sink_shape',
                'custitem_vanity_sink_size',
                'custitem_hyc_vanity_sink_type',
                'custitem_countertop_color',
                'custitem_fmt_top_edge_type',
                'custitem_countertop_finish',
                'custitem_countertop_material',
                'custitem_countertop_thickness',
                'custitem_countertop_thickness',
                'custitem_fmt_drawer_construction_types',
                'custitem_hyc_faucet_finish',
                'custitem_vl_faucet_handle_style',
                'custitem_hyc_fct_handle_style_grp',
                'custitem_fmt_faucet_hole_spacing',
                'custitem_fmt_faucet_hole_spacing',
                'custitem_hyc_faucet_material',
                'custitem_hyc_itm_faucet_mount_type',
                'custitem_hyc_spout_flow_rate',
                'custitem_hyc_itm_faucet_type',
                'custitem_hyc_faucet_type_group',
                'custitem_hyc_flow_regulator',
                'custitem_hyc_glass_edge_type',
                'custitem_hyc_cabinet_hw_finish',
                'custitem_fmt_installation_hole_dia',
                'custitem_fmt_max_countertop_thickness',
                'custitem_fmt_min_clearance_backsplas',
                'custitem_hyc_mirror_frame_color_group',
                'custitem_hyc_mirror_frame_finish',
                'custitem_hyc_mirror_frame_mat',
                'custitem_hyc_mirror_frame_style',
                'custitem_hyc_mirror_framed_color',
                'custitem_fmt_mirror_orientation',
                'custitem_hyc_mirror_shape',
                'custitem_fmt_number_of_cabinets',
                'custitem_fmt_number_of_sinks',
                'custitem_fmt_overall_faucet_height',
                'custitem_hyc_item_ptrap_included',
                'custitem_fmt_plumbling_cut_out',
                'custitem_fmt_predrilled_hole_dimension',
                'custitem_hyc_replace_backsplash_sku',
                'custitem_fmt_sink_color',
                'custitem_fmt_sink_color',
                'custitem_hyc_sink_finish',
                'custitem_fmt_sink_location',
                'custitem_vanity_sink_material',
                'custitem_vanity_sink_shape',
                'custitem_fmt_sink_shape',
                'custitem_hyc_vanity_sink_type',
                'custitem_fmt_adjustable_dimension_sp',
                'custitem_fmt_spout_height_top',
                'custitem_fmt_spout_reach_front',
                'custitem_fmt_spout_type',
                'custitem_fmt_style',
                'custitem_fmt_top_with_pre_drilled_hole',
                'custitem_fmt_upc_standard_uniform',
                'custitem_vanity_mounting_type',
                'custitem_fmt_top_edge_type',
                'custitem_hyc_washstand_mounting_type',
                'custitem_hyc_washstands_finish',
                'custitem_hyc_washstands_mat'
            ];

            // Filter out columns whose name matches any in the list
            mySearch.columns = mySearch.columns.filter(function (col) {
                return fieldsToRemove.indexOf(col.name) === -1;
            });
            
            // Add your formula columns here (as before)
            mySearch.columns.push(search.createColumn({name: 'custitem_hyc_itm_collection', label: 'netsuite-v:custitem_hyc_itm_collection:value (Variant Meta)'}));
            
            mySearch.save();
            */

            srch = search.create({
                type: "customrecord_fmt_itmlandedcostsetup",
                filters: [],
                columns: [
                    search.createColumn({name: "custrecord_fmt_costcategory", label: "Cost Category"}),
                    search.createColumn({name: "custrecord_fmt_lcpct", label: "Percentage"}),
                    search.createColumn({name: "custrecord_fmt_item", label: "Item"}),
                    search.createColumn({
                        name: "custrecord_fmt_ccwcostcategory",
                        join: "CUSTRECORD_FMT_COSTCATEGORY",
                        label: "Cost Category"
                    }),
                    search.createColumn({
                        name: "custitem_cbm",
                        join: "CUSTRECORD_FMT_ITEM",
                        label: "CBM"
                    })
                ],
                title: "JL - Item Landed Cost Setup"
            });
            srch.save();
            context.response.writePage('Done');
        }
    }

    return {
        onRequest: onRequest
    };
});