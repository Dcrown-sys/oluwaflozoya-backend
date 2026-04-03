const { sql } = require('../db');  // ✅ Template literal DB (postgres.js)


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
      error: error.message,
    });
  }
};

const createProject = async (req, res) => {
  try {
    const { 
      buyerId, 
      projectName, 
      projectType = 'residential', 
      location, 
      budget = 0, 
      description, 
      targetCompletionDate 
    } = req.body;

    // Validation
    if (!buyerId || !projectName?.trim() || !location?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Required: buyerId, projectName, location'
      });
    }

    // Verify user exists
    const userCheck = await sql`SELECT id FROM users WHERE id = ${buyerId}`;
    if (userCheck.length === 0) {
      return res.status(400).json({
        success: false,
        message: `User ${buyerId} not found`
      });
    }

    const result = await sql`
      INSERT INTO projects (
        buyer_id, project_name, project_type, 
        location_address, project_description, 
        estimated_end_date, budget, status
      )
      VALUES (
        ${buyerId},
        ${projectName.trim()},
        ${projectType},
        ${location.trim()},
        ${description ? description.trim() : null},
        ${targetCompletionDate || null},
        ${Number(budget)},
        'active'
      )
      RETURNING *
    `;

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: result[0]
    });

  } catch (error) {
    console.error('createProject error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create project',
      error: error.message
    });
  }
};

const getBuyerProjects = async (req, res) => {
  try {
    const { buyerId } = req.params;

    if (!buyerId) {
      return res.status(400).json({
        success: false,
        message: 'buyerId is required',
      });
    }

    // ✅ Convert to template literal SQL (consistent)
    const result = await sql`
  SELECT
    id,
    buyer_id,
    project_name,
    project_type,
    location_address,  
    project_description,  
    start_date,
    estimated_end_date,  
    status,
    created_at,
    updated_at
  FROM projects
  WHERE buyer_id = ${buyerId}
  ORDER BY created_at DESC
`;
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('getBuyerProjects error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch buyer projects',
      error: error.message,
    });
  }
};

// ✅ Export ALL functions
module.exports = { 
  getProjectDashboard, 
  createProject, 
  getBuyerProjects 
};
