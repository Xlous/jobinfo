/**
 * Cloudflare Worker — 飞书多维表格 API 代理
 * 
 * 功能：
 *   GET  /api/jobs          — 获取招聘信息列表（公开）
 *   POST /api/jobs          — 新增招聘信息（需管理员鉴权）
 *   PUT  /api/jobs/:id      — 修改招聘信息（需管理员鉴权）
 *   DELETE /api/jobs/:id    — 删除招聘信息（需管理员鉴权）
 *   GET  /api/stats         — 获取统计数据（公开）
 *   GET  /api/health        — 健康检查
 * 
 * 环境变量（在 Cloudflare Dashboard 或 wrangler.toml 中配置）：
 *   FEISHU_APP_ID          — 飞书应用 App ID
 *   FEISHU_APP_SECRET      — 飞书应用 App Secret
 *   FEISHU_APP_TOKEN       — 多维表格 App Token（在表格 URL 中获取）
 *   FEISHU_TABLE_ID        — 多维表格 Table ID
 *   ADMIN_TOKEN            — 管理员鉴权令牌（自定义，前端录入时需携带）
 *   FEISHU_BASE_URL        —（可选）飞书 API 基础地址，默认 https://open.feishu.cn/open-apis
 */

// ========== 飞书 API 封装 ==========

let cachedToken = null;
let tokenExpireAt = 0;

async function getTenantAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpireAt - 60000) {
    return cachedToken;
  }

  const baseUrl = env.FEISHU_BASE_URL || "https://open.feishu.cn/open-apis";
  const res = await fetch(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
    }),
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`获取飞书 token 失败: ${data.msg}`);
  }

  cachedToken = data.tenant_access_token;
  tokenExpireAt = now + data.expire * 1000;
  return cachedToken;
}

async function feishuRequest(env, method, path, body = null) {
  const token = await getTenantAccessToken(env);
  const baseUrl = env.FEISHU_BASE_URL || "https://open.feishu.cn/open-apis";
  const url = `${baseUrl}${path}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`飞书 API 错误: ${data.msg || data.code}`);
  }
  return data.data;
}

// ========== 飞书字段 <-> 前端数据映射 ==========

// 飞书多维表格字段名 -> 前端字段名
// 请根据你在飞书表格中实际创建的字段名调整以下映射
const FIELD_MAP = {
  company: "企业名称",
  title: "推文标题",
  date: "发布日期",
  category: "岗位类别",
  url: "推文链接",
};

// 前端字段名 -> 飞书字段名（反向映射）
const REVERSE_FIELD_MAP = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [v, k])
);

// 将飞书记录转换为前端 Job 对象
function recordToJob(record) {
  const fields = record.fields || {};
  const job = {
    id: record.record_id,
    company: "",
    title: "",
    date: "",
    category: "",
    url: "",
  };

  for (const [feishuName, value] of Object.entries(fields)) {
    const frontKey = REVERSE_FIELD_MAP[feishuName];
    if (!frontKey) continue;

    // 处理飞书不同字段类型的返回值
    if (frontKey === "date" && Array.isArray(value) && value.length > 0) {
      // 飞书日期字段返回毫秒时间戳
      const ts = value[0];
      if (typeof ts === "number") {
        job.date = new Date(ts).toISOString().slice(0, 10);
      } else if (typeof ts === "string") {
        job.date = ts;
      }
    } else if (frontKey === "category") {
      // 飞书多选字段返回数组
      if (Array.isArray(value)) {
        job.category = value;
      } else if (typeof value === "string") {
        job.category = value;
      }
    } else if (typeof value === "string") {
      job[frontKey] = value;
    } else if (Array.isArray(value)) {
      // 飞书富文本/链接字段可能返回数组
      const item = value[0];
      if (typeof item === "string") {
        job[frontKey] = item;
      } else if (item && typeof item === "object") {
        job[frontKey] = item.text || item.name || item.link || "";
      }
    }
  }

  return job;
}

// 将前端 Job 对象转换为飞书记录字段
function jobToFields(job) {
  const fields = {};

  if (job.company !== undefined) {
    fields[FIELD_MAP.company] = job.company;
  }
  if (job.title !== undefined) {
    fields[FIELD_MAP.title] = job.title;
  }
  if (job.date !== undefined) {
    // 飞书日期字段需要毫秒时间戳
    if (job.date) {
      fields[FIELD_MAP.date] = new Date(job.date).getTime();
    } else {
      fields[FIELD_MAP.date] = null;
    }
  }
  if (job.category !== undefined) {
    fields[FIELD_MAP.category] = Array.isArray(job.category)
      ? job.category
      : job.category
        ? [job.category]
        : [];
  }
  if (job.url !== undefined) {
    fields[FIELD_MAP.url] = { text: job.url || "", link: job.url || "" };
  }

  return fields;
}

// ========== 路由处理 ==========

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function checkAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (!token || token !== env.ADMIN_TOKEN) {
    return false;
  }
  return true;
}

async function fetchAllRecords(env) {
  const appToken = env.FEISHU_APP_TOKEN;
  const tableId = env.FEISHU_TABLE_ID;
  let allRecords = [];
  let pageToken = null;
  let hasMore = false;

  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);

    const data = await feishuRequest(
      env,
      "GET",
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`
    );
    allRecords = allRecords.concat(data.items || []);
    pageToken = data.page_token;
    hasMore = data.has_more;
  } while (pageToken && hasMore);

  return allRecords;
}

async function handleJobs(request, env) {
  const records = await fetchAllRecords(env);
  const jobs = records.map(recordToJob);

  // 按日期倒序
  jobs.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return jsonResponse({
    success: true,
    data: jobs,
    updatedAt: new Date().toISOString().slice(0, 10),
  });
}

async function handleCreateJob(request, env) {
  if (!checkAdmin(request, env)) {
    return jsonResponse({ success: false, error: "未授权" }, 401);
  }

  const body = await request.json();
  const fields = jobToFields(body);

  const data = await feishuRequest(
    env,
    "POST",
    `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records`,
    { fields }
  );

  return jsonResponse({
    success: true,
    data: recordToJob(data.record),
  });
}

async function handleUpdateJob(request, env, recordId) {
  if (!checkAdmin(request, env)) {
    return jsonResponse({ success: false, error: "未授权" }, 401);
  }

  const body = await request.json();
  const fields = jobToFields(body);

  const data = await feishuRequest(
    env,
    "PUT",
    `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records/${recordId}`,
    { fields }
  );

  return jsonResponse({
    success: true,
    data: recordToJob(data.record),
  });
}

async function handleDeleteJob(request, env, recordId) {
  if (!checkAdmin(request, env)) {
    return jsonResponse({ success: false, error: "未授权" }, 401);
  }

  await feishuRequest(
    env,
    "DELETE",
    `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records/${recordId}`
  );

  return jsonResponse({ success: true });
}

async function handleStats(request, env) {
  const records = await fetchAllRecords(env);
  const jobs = records.map(recordToJob);

  // 统计分类分布
  const categoryMap = {};
  jobs.forEach((job) => {
    const cats = Array.isArray(job.category)
      ? job.category
      : job.category
        ? [job.category]
        : [];
    cats.forEach((cat) => {
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    });
  });

  // 统计最近7天更新数
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentCount = jobs.filter(
    (job) => job.date && new Date(job.date) >= sevenDaysAgo
  ).length;

  return jsonResponse({
    success: true,
    data: {
      total: jobs.length,
      categories: categoryMap,
      recentCount,
      updatedAt: new Date().toISOString().slice(0, 10),
    },
  });
}

// ========== 主入口 ==========

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS 预检
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // 健康检查
    if (path === "/api/health") {
      return jsonResponse({
        success: true,
        message: "Worker is running",
        configured: !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
      });
    }

    try {
      // 路由
      if (path === "/api/jobs") {
        if (method === "GET") return await handleJobs(request, env);
        if (method === "POST") return await handleCreateJob(request, env);
      }

      // /api/jobs/:id
      const jobMatch = path.match(/^\/api\/jobs\/(.+)$/);
      if (jobMatch) {
        const recordId = jobMatch[1];
        if (method === "PUT") return await handleUpdateJob(request, env, recordId);
        if (method === "DELETE") return await handleDeleteJob(request, env, recordId);
      }

      if (path === "/api/stats" && method === "GET") {
        return await handleStats(request, env);
      }

      return jsonResponse({ success: false, error: "未找到接口: " + path }, 404);
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  },
};
