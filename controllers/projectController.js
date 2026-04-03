const { sql } = require('../db');  // ✅ Your template literal DB

const getProjectDashboard = async (req, res) => {
  const { projectId } = req.params;

  try {
    // 1. Get project
    const projectResult = await sql`
      SELECT id, project_name 
      FROM projects 
      WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project = projectResult[0];

    // 2. Get dashboard summary
    const dashboardResult = await sql`
      SELECT * 
      FROM project_dashboards 
      WHERE project_id = ${projectId}
    `;

    const dashboard = dashboardResult[0] || {};

    // 3. Get purchased materials
    const materialsResult = await sql`
      SELECT 
        id,
        material_name,
        quantity,
        unit,
        unit_price,
        total_price,
        supplier_name,
        purchased_at
      FROM project_material_purchases
      WHERE project_id = ${projectId}
      ORDER BY purchased_at DESC
    `;

    const purchasedItems = materialsResult;

    // ✅ Response (unchanged)
    res.json({
      success: true,
      message: "Project dashboard fetched successfully",
      data: {
        projectId: project.id,
        projectName: project.project_name,
        currency: "NGN",
        budget: {
          totalBudget: Number(dashboard.total_budget || 0),
          spentAmount: Number(dashboard.spent_amount || 0),
          remainingAmount: Number(dashboard.remaining_amount || 0),
        },
        materials: {
          totalMaterialsPlanned: Number(dashboard.total_materials_planned || 0),
          totalMaterialsPurchased: Number(dashboard.total_materials_purchased || 0),
          purchasedItems,
        },
        timeline: {
          startDate: dashboard.start_date || null,
          estimatedEndDate: dashboard.estimated_end_date || null,
          completionPercentage: Number(dashboard.completion_percentage || 0),
          daysRemaining: dashboard.days_remaining || null,
        },
        stage: {
          currentStage: dashboard.current_stage || "planning",
          updatedAt: dashboard.stage_updated_at || null,
          notes: dashboard.stage_notes || "",
        },
        updatedAt: dashboard.updated_at || null,
      },
    });

  } catch (error) {
    console.error("getProjectDashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load project dashboard",
      error: error.message,  // ✅ Debug
    });
  }
};

module.exports = { getProjectDashboard };  // ✅ CommonJS export