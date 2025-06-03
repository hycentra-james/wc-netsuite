/**
 **********************************************************************************
 * ** THIS FILE IS ONLY USED FOR TEMPORARY CREATING SAVED SEARCH FOR PIM PROJECT **
 **********************************************************************************
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(["N/search", "N/ui/serverWidget", "N/log"], function (
  search,
  serverWidget,
  log
) {
  function onRequest(context) {
    if (context.request.method === "GET") {
      try {
        // Create the saved search
        var savedSearch = search.create({
          type: search.Type.ITEM,
          filters: [
            ["type", search.Operator.ANYOF, ["InvtPart"]],
            "AND",
            ["isinactive", search.Operator.IS, false],
            "AND",
            ["custitem_item_status", search.Operator.ANYOF, ["1", "2"]],
            "AND",
            ["class", search.Operator.ANYOF, ["1"]], //***************************************************** 1) Product Category
          ],
          columns: [
            search.createColumn({ name: "internalid" }),
            search.createColumn({ name: "itemid" }),
            search.createColumn({ name: "custitem_item_status" }),

            //************************************************************************************************ 2) Fields
            search.createColumn({ name: "custitem_fmt_item_width" }),
            search.createColumn({ name: "custitem_fmt_item_length" }),
            search.createColumn({ name: "custitem_fmt_item_height" }),
            search.createColumn({ name: "custitem_wc_item_weight" }),
            search.createColumn({ name: "custitem_fmt_box_width" }),
            search.createColumn({ name: "custitem_fmt_box_length" }),
            search.createColumn({ name: "custitem_fmt_box_height" }),
            search.createColumn({ name: "custitem_fmt_box_weight" }),
            search.createColumn({ name: "custitem_fmt_ships_palletized" }),
            search.createColumn({ name: "custitem_fmt_ship_type" }),
            search.createColumn({ name: "custitem_fmt_freight_class" }),
            search.createColumn({ name: "custitem_fmt_nmfc_code" }),
            search.createColumn({ name: "custitem_fmt_pallet_quantity" }),
            search.createColumn({ name: "custitem_fmt_pallet_weight" }),
            search.createColumn({ name: "custitem_pallet_dimension" }),
            search.createColumn({ name: "custitem_fmt_total_carton_weight" }),
            search.createColumn({ name: "custitem_fmt_no_boxes" }),
            search.createColumn({ name: "custitem_fmt_shipping_weight" }),
            search.createColumn({ name: "custitem_fmt_shipping_width" }),
            search.createColumn({ name: "custitem_fmt_shipping_length" }),
            search.createColumn({ name: "custitem_fmt_shipping_height" }),
            search.createColumn({ name: "custitem_hyc_shipping_cu_ft" }),
            search.createColumn({ name: "custitem_spec_pdf_link" }),
            search.createColumn({ name: "custitem_installation_guide_link" }),
            search.createColumn({
              name: "custitem_fmt_include_inventory_feeds",
            }),
            search.createColumn({ name: "custitem_hyc_backboard_included" }),
            search.createColumn({ name: "custitem_hyc_backsplash_material" }),
            search.createColumn({ name: "custitem_hyc_cabinet_material" }),
            search.createColumn({ name: "custitem_fmt_cabinet_material" }),
            search.createColumn({ name: "custitem_countertop_thickness" }),
            search.createColumn({ name: "custitem_countertop_color" }),
            search.createColumn({ name: "custitem_countertop_finish" }),
            search.createColumn({ name: "custitem_countertop_material" }),
            search.createColumn({ name: "custitem_hyc_itm_collection" }),
            search.createColumn({ name: "custitem_fmt_number_of_sinks" }),
            search.createColumn({ name: "custitem_fmt_sink_shape" }),
            search.createColumn({ name: "custitem_hyc_sink_finish" }),
            search.createColumn({ name: "custitem_fmt_sink_material" }),
            search.createColumn({ name: "custitem_fmt_sink_color" }),
            search.createColumn({
              name: "custitem_fmt_vanity_assembly_required",
            }),
            search.createColumn({ name: "custitem_hyc_cabinet_backboard_mat" }),
            search.createColumn({ name: "custitem_fmt_style" }),
            search.createColumn({ name: "custitem_fmt_color" }),
            search.createColumn({ name: "custitem_hyc_cabinet_color_group" }),
            search.createColumn({ name: "custitem_hyc_cabinet_wood_tone" }),
            search.createColumn({ name: "custitem_hyc_cabinet_door_mat" }),
            search.createColumn({
              name: "custitem_hyc_cabinet_door_panel_mat",
            }),
            search.createColumn({ name: "custitem_hyc_cabinet_drawer_mat" }),
            search.createColumn({
              name: "custitem_fmt_vanity_hardware_included",
            }),
            search.createColumn({ name: "custitem_vanity_mounting_type" }),
            search.createColumn({
              name: "custitem_hyc_cabinet_side_board_mat",
            }),
            search.createColumn({ name: "custitem_vanity_sink_material" }),
            search.createColumn({ name: "custitem_vanity_sink_shape" }),
            search.createColumn({ name: "custitem_vanity_sink_size" }),
            search.createColumn({ name: "custitem_hyc_vanity_sink_type" }),
            search.createColumn({
              name: "custitem_hyc_cabinet_struct_frame_mat",
            }),
            search.createColumn({
              name: "custitem_sc_vanity_cabinet_paint_type",
            }),
            search.createColumn({ name: "custitem_vanity_sink_part" }),
            search.createColumn({ name: "custitem_fmt_backsplash_included" }),
            search.createColumn({ name: "custitem_backsplash_purchasable" }),
            search.createColumn({ name: "custitem_hyc_cabinet_hw_finish" }),
            search.createColumn({ name: "custitem_fmt_adjustable_feet" }),
            search.createColumn({ name: "custitem_fmt_adjustable_shelves" }),
            search.createColumn({ name: "custitem_fmt_backsplash_height" }),
            search.createColumn({ name: "custitem_fmt_backsplash_length" }),
            search.createColumn({ name: "custitem_fmt_backsplash_thickness" }),
            search.createColumn({
              name: "custitem_fmt_drawer_construction_types",
            }),
            search.createColumn({ name: "custitem_fmt_glass_panel_door" }),
            search.createColumn({ name: "custitem_fmt_weight_capacity" }),
            search.createColumn({ name: "custitem_fmt_faucet_hole_spacing" }),
            search.createColumn({
              name: "custitem_fmt_cabinet_hinges_material",
            }),
            search.createColumn({ name: "custitem_fmt_cabinet_hinges_part" }),
            search.createColumn({
              name: "custitem_fmt_number_of_pre_drilled_h",
            }),
            search.createColumn({ name: "custitem_fmt_adjustable_feet_max_h" }),
            search.createColumn({ name: "custitem_fmt_number_of_cabinets" }),
            search.createColumn({
              name: "custitem_fmt_number_of_decorative_draw",
            }),
            search.createColumn({ name: "custitem_fmt_number_of_knobs" }),
            search.createColumn({ name: "custitem_fmt_number_of_pulls" }),
            search.createColumn({
              name: "custitem_fmt_number_of_cabinet_doors",
            }),
            search.createColumn({
              name: "custitem_fmt_number_of_flip_out_front",
            }),
            search.createColumn({
              name: "custitem_fmt_number_of_functional_draw",
            }),
            search.createColumn({ name: "custitem_fmt_number_of_shelves" }),
            search.createColumn({ name: "custitem_fmt_plumbling_cut_out" }),
            search.createColumn({
              name: "custitem_fmt_predrilled_hole_dimension",
            }),
            search.createColumn({ name: "custitem_fmt_sink_location" }),
            search.createColumn({ name: "custitem_fmt_sink_volume" }),
            search.createColumn({
              name: "custitem_fmt_sliding_track_material",
            }),
            search.createColumn({ name: "custitem_fmt_sliding_track_part" }),
            search.createColumn({
              name: "custitem_fmt_soft_close_door_hinges",
            }),
            search.createColumn({
              name: "custitem_fmt_soft_close_drawer_glides",
            }),
            search.createColumn({ name: "custitem_fmt_top_edge_type" }),
            search.createColumn({ name: "custitem_hyc_counter_top_weight" }),
            search.createColumn({
              name: "custitem_fmt_top_with_pre_drilled_hole",
            }),
            search.createColumn({ name: "custitem_fmt_drawers_included" }),
            search.createColumn({
              name: "custitem_fmt_overflow_hole_included",
            }),
            search.createColumn({ name: "custitem_hyc_sink_weight" }),
            search.createColumn({ name: "custitem_hyc_cabinet_hinges_mfr" }),
            search.createColumn({ name: "custitem_hyc_sliding_track_mfr" }),
            search.createColumn({ name: "custitem_hyc_vanity_short_code" }),
            search.createColumn({
              name: "custitem_fmt_compatible_sidesplash_sku",
            }),
            search.createColumn({
              name: "custitem_hyc_replace_backsplash_sku",
            }),
            search.createColumn({ name: "custitem_fmt_cabinet_door_width" }),
          ],
          title: "PIM - Bathroom Vanities (Adv) - Attributes", // *************************************************** 3) Search Title
          //id: "customsearch_my_custom_item_search",
          isPublic: true,
        });

        // Save the search
        var searchId = savedSearch.save();
        log.debug("Saved Search Created", "Saved search ID: " + searchId);

        // Create the response form
        var form = serverWidget.createForm({
          title: "Saved Search Created: " + searchId,
        });

        form.addField({
          id: "custpage_message",
          type: serverWidget.FieldType.INLINEHTML,
          label: " ",
          defaultValue:
            "Saved search created successfully with ID: " + searchId,
        });

        context.response.writePage(form);
      } catch (e) {
        log.error("Error Creating Saved Search", e.toString());
        var errorForm = serverWidget.createForm({
          title: "Error Creating Saved Search",
        });

        errorForm.addField({
          id: "custpage_errormessage",
          type: serverWidget.FieldType.INLINEHTML,
          label: " ",
          defaultValue: "Error: " + e.toString(),
        });

        context.response.writePage(errorForm);
      }
    }
  }

  return {
    onRequest: onRequest,
  };
});
