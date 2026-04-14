const { sql } = require('../db');

const getProjectDashboard = async (req, res) => {
  const { projectId } = req.params;

  try {
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

    const dashboardResult = await sql`
      SELECT *
      FROM project_dashboards
      WHERE project_id = ${projectId}
    `;

    const dashboard = dashboardResult[0] || {};

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

    return res.json({
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
          totalMaterialsPurchased: Number(
            dashboard.total_materials_purchased || 0
          ),
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
    return res.status(500).json({
      success: false,
      message: "Failed to load project dashboard",
      error: error.message,
    });
  }
};

const createProject = async (req, res) => {
  try {
    const {
      buyerId,
      projectName,
      projectType = "residential",
      location,
      description,
      totalBudget,
      startDate,
      estimatedEndDate,
    } = req.body;

    if (!buyerId || !projectName?.trim() || !location?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Required: buyerId, projectName, location",
      });
    }

    if (!totalBudget || Number(totalBudget) <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid totalBudget is required",
      });
    }

    const userCheck = await sql`
      SELECT id
      FROM users
      WHERE id = ${buyerId}
    `;

    if (userCheck.length === 0) {
      return res.status(400).json({
        success: false,
        message: `User ${buyerId} not found`,
      });
    }

    // 1. Insert into projects
    const projectResult = await sql`
      INSERT INTO projects (
        buyer_id,
        project_name,
        project_type,
        location_address,
        project_description,
        status
      )
      VALUES (
        ${buyerId},
        ${projectName.trim()},
        ${projectType},
        ${location.trim()},
        ${description ? description.trim() : null},
        'active'
      )
      RETURNING *
    `;

    const createdProject = projectResult[0];

    // 2. Insert into project_dashboards
    const dashboardResult = await sql`
      INSERT INTO project_dashboards (
        project_id,
        total_budget,
        spent_amount,
        remaining_amount,
        total_materials_planned,
        total_materials_purchased,
        start_date,
        estimated_end_date,
        completion_percentage,
        days_remaining,
        current_stage,
        stage_notes
      )
      VALUES (
        ${createdProject.id},
        ${Number(totalBudget)},
        0,
        ${Number(totalBudget)},
        0,
        0,
        ${startDate || null},
        ${estimatedEndDate || null},
        0,
        NULL,
        'planning',
        ''
      )
      RETURNING *
    `;

    const createdDashboard = dashboardResult[0];

    return res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: {
        ...createdProject,
        budget: Number(createdDashboard.total_budget || 0),
        total_budget: Number(createdDashboard.total_budget || 0),
        start_date: createdDashboard.start_date || null,
        estimated_end_date: createdDashboard.estimated_end_date || null,
        spent_amount: Number(createdDashboard.spent_amount || 0),
        remaining_amount: Number(createdDashboard.remaining_amount || 0),
        current_stage: createdDashboard.current_stage || "planning",
      },
    });
  } catch (error) {
    console.error("createProject error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create project",
      error: error.message,
    });
  }
};

const getBuyerProjects = async (req, res) => {
  try {
    const { buyerId } = req.params;

    if (!buyerId) {
      return res.status(400).json({
        success: false,
        message: "buyerId is required",
      });
    }

    const result = await sql`
      SELECT
        p.id,
        p.buyer_id,
        p.project_name,
        p.project_type,
        p.location_address,
        p.project_description,
        pd.start_date,
        pd.estimated_end_date,
        p.status,
        p.created_at,
        p.updated_at,
        COALESCE(pd.total_budget, 0) AS budget,
        COALESCE(pd.total_budget, 0) AS total_budget,
        COALESCE(pd.spent_amount, 0) AS spent_amount,
        COALESCE(pd.remaining_amount, 0) AS remaining_amount
      FROM projects p
      LEFT JOIN project_dashboards pd
        ON pd.project_id = p.id
      WHERE p.buyer_id = ${buyerId}
      ORDER BY p.created_at DESC
    `;

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getBuyerProjects error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch buyer projects",
      error: error.message,
    });
  }
};

module.exports = {
  getProjectDashboard,
  createProject,
  getBuyerProjects,
};