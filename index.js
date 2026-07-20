const DEFAULT_CMS_API = "https://ushi-api-official.brassband06.workers.dev";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･ー―–—_'’"「」『』（）()\-]/g, "");
}

function normalizeWorkflowStatus(place) {
  const raw = String(
    place.workflow_status ||
    place.workflowStatus ||
    place.publish_status ||
    place.publishStatus ||
    place.status ||
    ""
  );

  if (raw === "published" || raw === "publish_ready") return "publish_ready";
  if (raw === "ushi_verified") return "ushi_verified";
  if (raw === "needs_review") return "needs_review";

  // CMSの公開専用 /api/places は公開済みデータだけを返すため、
  // 状態フィールドが省略されていても公開可能として扱う。
  if (!raw && place.id && place.name) return "publish_ready";

  return "ai_draft";
}

function isPublishReady(place) {
  return normalizeWorkflowStatus(place) === "publish_ready";
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value).split(/\n|、|,/).map(v => v.trim()).filter(Boolean);
}

function publicPlace(place) {
  return {
    id: place.id,
    cityCode: place.city_code || place.cityCode || "",
    category: place.category || "",
    name: place.name || "",
    canonicalId: place.canonical_key || place.canonicalKey || "",
    aliases: normalizeArray(place.aliases),
    score: place.score ?? place.ai_score ?? place.aiScore ?? null,
    aiScore: place.ai_score ?? place.aiScore ?? null,
    ushiScore: place.ushi_score ?? place.ushiScore ?? null,
    label: place.label || "ai",
    overview: place.overview || place.summary || "",
    ushiComment: place.comment || "",
    travelExperience: place.travel_experience || place.travelExperience || "",
    caution: place.actual_caution || place.actualCaution || "",
    point: place.point || "",
    relatedSpots: normalizeArray(place.related_spots || place.relatedSpots),
    route: normalizeArray(place.route),
    area: place.area_name || place.areaName || "",
    nearestRail: place.nearest_rail || place.nearestRail || place.nearest_station || "",
    nearestBus: place.nearest_bus || place.nearestBus || "",
    recommendedAccess: place.recommended_access || place.recommendedAccess || "",
    walkingTime: place.walking_time || place.walkingTime || "",
    recommendedDuration: place.recommended_duration || place.recommendedDuration || "",
    address: place.address || "",
    checkedAt: place.checked_at || place.checkedAt || "",
    reservation: place.reservation || ""
  };
}

async function fetchCms(env, path, init = {}) {
  const base = String(env.CMS_API_URL || DEFAULT_CMS_API).replace(/\/$/, "");
  const target = base + path;

  if (env.CMS_SERVICE && typeof env.CMS_SERVICE.fetch === "function") {
    return env.CMS_SERVICE.fetch(new Request(target, init));
  }

  return fetch(target, init);
}

async function cmsRequest(env, path, requireAdmin = false) {
  const key = String(env.CMS_ADMIN_KEY || "");

  if (requireAdmin && !key) {
    throw new Error("CMS_ADMIN_KEY is not configured.");
  }

  const headers = { "accept": "application/json" };
  if (key) headers["X-Admin-Key"] = key;

  const response = await fetchCms(env, path, { headers });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || data.message || `CMS ${response.status}`);
  }
  return data;
}

async function getPlaces(env) {
  const candidates = [
    { path: "/api/places", requireAdmin: false },
    { path: "/api/admin/places", requireAdmin: true },
    { path: "/api/admin/places/", requireAdmin: true },
    { path: "/places", requireAdmin: false }
  ];

  const attempts = [];

  for (const candidate of candidates) {
    try {
      const data = await cmsRequest(env, candidate.path, candidate.requireAdmin);
      const places =
        Array.isArray(data.places) ? data.places :
        Array.isArray(data.items) ? data.items :
        Array.isArray(data) ? data :
        null;

      if (places) return places;
      attempts.push(`${candidate.path}: response format mismatch`);
    } catch (error) {
      attempts.push(`${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error("CMS places endpoint not found. " + attempts.join(" | "));
}


async function getAllPlacesForStatus(env) {
  const key = String(env.CMS_ADMIN_KEY || "");

  if (!key) {
    throw new Error("CMS_ADMIN_KEY is required for checking unpublished content.");
  }

  const candidates = [
    "/api/admin/places",
    "/api/admin/places/"
  ];
  const attempts = [];

  for (const path of candidates) {
    try {
      const data = await cmsRequest(env, path, true);
      const places =
        Array.isArray(data.places) ? data.places :
        Array.isArray(data.items) ? data.items :
        Array.isArray(data) ? data :
        null;

      if (places) return places;
      attempts.push(`${path}: response format mismatch`);
    } catch (error) {
      attempts.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error("CMS admin places endpoint unavailable. " + attempts.join(" | "));
}

async function getCities(env) {
  const base = String(env.CMS_API_URL || DEFAULT_CMS_API).replace(/\/$/, "");
  const response = await fetch(base + "/api/cities", {
    headers: { "accept": "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Cities ${response.status}`);
  return Array.isArray(data.cities) ? data.cities : [];
}

function categoryMatches(place, category) {
  return !category || String(place.category || "") === category;
}

function cityMatches(place, city) {
  return !city || String(place.city_code || place.cityCode || "") === city;
}

function findExactPlace(places, query) {
  const target = normalizeText(query);
  if (!target) return null;

  return places.find(place => {
    const names = [
      place.name,
      place.canonical_key,
      place.canonicalKey,
      ...normalizeArray(place.aliases)
    ].map(normalizeText);
    return names.includes(target);
  }) || null;
}


function findPublicPlaceByKey(places, key) {
  const decoded = decodeURIComponent(String(key || "")).trim();
  const normalized = normalizeText(decoded);

  return places.find(place => {
    const id = String(place.id ?? "");
    const canonical = String(place.canonical_key || place.canonicalKey || "");
    const name = String(place.name || "");

    return (
      id === decoded ||
      canonical === decoded ||
      normalizeText(canonical) === normalized ||
      normalizeText(name) === normalized
    );
  }) || null;
}

function publicDetail(place) {
  const detail = publicPlace(place);

  return {
    ...detail,
    availability: "available",
    workflowStatus: "publish_ready",
    detailUrl: detail.canonicalId
      ? `/api/public/places/${encodeURIComponent(detail.canonicalId)}`
      : `/api/public/places/${encodeURIComponent(String(detail.id))}`
  };
}


function scoreValue(place) {
  const value =
    place.ushi_score ??
    place.ushiScore ??
    place.score ??
    place.ai_score ??
    place.aiScore ??
    0;

  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sortPublicPlaces(places, sort) {
  const rows = [...places];

  if (sort === "name") {
    return rows.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ja")
    );
  }

  if (sort === "checked") {
    return rows.sort((a, b) =>
      String(b.checked_at || b.checkedAt || "")
        .localeCompare(String(a.checked_at || a.checkedAt || ""))
    );
  }

  return rows.sort((a, b) => {
    const scoreDiff = scoreValue(b) - scoreValue(a);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), "ja");
  });
}

function categorySummary(places) {
  const summary = {
    hotel: 0,
    spot: 0,
    food: 0,
    other: 0
  };

  for (const place of places) {
    const category = String(place.category || "");
    if (Object.prototype.hasOwnProperty.call(summary, category)) {
      summary[category] += 1;
    } else {
      summary.other += 1;
    }
  }

  return summary;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({ ok: true });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/" || path === "/health") {
        return json({
          ok: true,
          version: "PUBLIC-API-V1.7-CITY-CATEGORY-LISTS",
          rule: "Only publish-ready content is returned. City and category lists support filtering, sorting, pagination, and category summaries. Individual detail is available by ID, Canonical ID, or exact name. Unpublished records are never exposed."
        });
      }

      if (path === "/api/public/cities") {
        const cities = await getCities(env);
        const publicCodes = String(env.PUBLIC_CITY_CODES || "")
          .split(",").map(v => v.trim()).filter(Boolean);

        const filtered = cities.filter(city => {
          const code = city.code || city.city_code || "";
          if (publicCodes.length) return publicCodes.includes(code);
          return String(city.status || "") === "published";
        });

        return json({
          ok: true,
          count: filtered.length,
          cities: filtered.map(city => ({
            code: city.code || city.city_code || "",
            nameJa: city.name_ja || city.nameJa || city.name || "",
            nameEn: city.name_en || city.nameEn || "",
            country: city.country_name || city.country || "",
            flag: city.flag_emoji || city.flag || "",
            status: "published",
            sortOrder: Number(city.sort_order ?? city.sortOrder ?? 999)
          })).sort((a, b) => a.sortOrder - b.sortOrder)
        });
      }

      if (path === "/api/public/debug-cms") {
        const base = String(env.CMS_API_URL || DEFAULT_CMS_API).replace(/\/$/, "");
        const hasKey = Boolean(String(env.CMS_ADMIN_KEY || ""));
        const candidates = [
          "/api/admin/places",
          "/api/admin/places/",
          "/api/places",
          "/places"
        ];
        const results = [];

        for (const candidate of candidates) {
          try {
            const response = await fetchCms(env, candidate, {
              headers: {
                "X-Admin-Key": String(env.CMS_ADMIN_KEY || ""),
                "accept": "application/json"
              }
            });
            const body = await response.text();
            results.push({
              path: candidate,
              status: response.status,
              ok: response.ok,
              preview: body.slice(0, 160)
            });
          } catch (error) {
            results.push({
              path: candidate,
              status: 0,
              ok: false,
              preview: error instanceof Error ? error.message : String(error)
            });
          }
        }

        return json({
          ok: true,
          cmsApiUrl: base,
          cmsAdminKeyConfigured: hasKey,
          cmsServiceBindingConfigured: Boolean(env.CMS_SERVICE),
          results
        });
      }

      if (path === "/api/public/places") {
        const places = await getPlaces(env);
        const city = url.searchParams.get("city") || "";
        const category = url.searchParams.get("category") || "";
        const q = normalizeText(url.searchParams.get("q") || "");
        const sort = url.searchParams.get("sort") || "score";
        const limitRaw = Number(url.searchParams.get("limit") || 100);
        const offsetRaw = Number(url.searchParams.get("offset") || 0);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 100;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

        const filtered = places
          .filter(place => cityMatches(place, city))
          .filter(place => categoryMatches(place, category))
          .filter(place => {
            if (!q) return true;
            const haystack = [
              place.name,
              place.canonical_key,
              place.canonicalKey,
              ...normalizeArray(place.aliases)
            ].map(normalizeText).join(" ");
            return haystack.includes(q);
          });

        const sorted = sortPublicPlaces(filtered, sort);
        const page = sorted.slice(offset, offset + limit).map(publicPlace);

        return json({
          ok: true,
          city: city || "all",
          category: category || "all",
          sort,
          total: sorted.length,
          count: page.length,
          offset,
          limit,
          hasMore: offset + page.length < sorted.length,
          categorySummary: categorySummary(filtered),
          places: page
        });
      }

      if (path === "/api/public/city") {
        const city = url.searchParams.get("code") || "";
        if (!city.trim()) {
          return json({ ok: false, error: "code is required" }, 400);
        }

        const places = await getPlaces(env);
        const cityPlaces = places.filter(place => cityMatches(place, city));

        return json({
          ok: true,
          city,
          total: cityPlaces.length,
          categorySummary: categorySummary(cityPlaces),
          categories: {
            hotels: sortPublicPlaces(
              cityPlaces.filter(place => place.category === "hotel"),
              "score"
            ).map(publicPlace),
            spots: sortPublicPlaces(
              cityPlaces.filter(place => place.category === "spot"),
              "score"
            ).map(publicPlace),
            food: sortPublicPlaces(
              cityPlaces.filter(place => place.category === "food"),
              "score"
            ).map(publicPlace)
          }
        });
      }

      if (path.startsWith("/api/public/places/")) {
        const key = path.slice("/api/public/places/".length);
        if (!key.trim()) {
          return json({ ok: false, status: "not_found", message: "施設IDまたはCanonical IDが必要です。" }, 404);
        }

        const places = await getPlaces(env);
        const found = findPublicPlaceByKey(places, key);

        if (!found) {
          return json({
            ok: false,
            status: "not_found",
            message: "公開可能な施設が見つかりません。"
          }, 404);
        }

        return json({
          ok: true,
          status: "available",
          place: publicDetail(found)
        });
      }

      if (path === "/api/public/place") {
        const key =
          url.searchParams.get("canonicalId") ||
          url.searchParams.get("id") ||
          url.searchParams.get("name") ||
          "";

        if (!key.trim()) {
          return json({
            ok: false,
            error: "canonicalId, id, or name is required"
          }, 400);
        }

        const places = await getPlaces(env);
        const found = findPublicPlaceByKey(places, key);

        if (!found) {
          return json({
            ok: false,
            status: "not_found",
            message: "公開可能な施設が見つかりません。"
          }, 404);
        }

        return json({
          ok: true,
          status: "available",
          place: publicDetail(found)
        });
      }

      if (path === "/api/public/search-status") {
        const q = url.searchParams.get("q") || "";
        if (!q.trim()) return json({ error: "q is required" }, 400);

        const publicPlaces = await getPlaces(env);
        const publicFound = findExactPlace(publicPlaces, q);

        if (publicFound) {
          return json({
            ok: true,
            status: "available",
            place: publicPlace(publicFound)
          });
        }

        let allPlaces;
        try {
          allPlaces = await getAllPlacesForStatus(env);
        } catch (error) {
          return json({
            ok: false,
            status: "status_check_unavailable",
            error: error instanceof Error ? error.message : String(error),
            message: "未公開施設の存在確認に必要な管理キーを確認してください。"
          }, 503);
        }

        const internalFound = findExactPlace(allPlaces, q);

        if (internalFound) {
          return json({
            ok: true,
            status: "checking",
            name: internalFound.name || q,
            message: "現在、この施設の情報を確認中です。確認が完了すると利用できるようになります。"
          });
        }

        return json({
          ok: true,
          status: "not_registered",
          message: "この施設はまだ登録されていません。調査リクエストを送信できます。"
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  }
};
