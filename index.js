
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
    ""
  );

  if (raw === "published" || raw === "publish_ready") return "publish_ready";
  if (raw === "ushi_verified") return "ushi_verified";
  if (raw === "needs_review") return "needs_review";
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

async function cmsRequest(env, path) {
  const base = String(env.CMS_API_URL || DEFAULT_CMS_API).replace(/\/$/, "");
  const key = String(env.CMS_ADMIN_KEY || "");

  if (!key) {
    throw new Error("CMS_ADMIN_KEY is not configured.");
  }

  const response = await fetch(base + path, {
    headers: {
      "X-Admin-Key": key,
      "accept": "application/json"
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || data.message || `CMS ${response.status}`);
  }
  return data;
}

async function getPlaces(env) {
  const data = await cmsRequest(env, "/api/admin/places");
  return Array.isArray(data.places) ? data.places : [];
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
          version: "PUBLIC-API-V1-PUBLISH-READY-ONLY",
          rule: "Only publish_ready / legacy published content is returned."
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

      if (path === "/api/public/places") {
        const places = await getPlaces(env);
        const city = url.searchParams.get("city") || "";
        const category = url.searchParams.get("category") || "";
        const q = normalizeText(url.searchParams.get("q") || "");

        const rows = places
          .filter(isPublishReady)
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
          })
          .map(publicPlace);

        return json({ ok: true, count: rows.length, places: rows });
      }

      if (path.startsWith("/api/public/places/")) {
        const key = decodeURIComponent(path.split("/").pop() || "");
        const places = await getPlaces(env);
        const found = places.find(place =>
          String(place.id) === key ||
          String(place.canonical_key || place.canonicalKey || "") === key
        );

        if (!found || !isPublishReady(found)) {
          return json({ ok: false, status: "not_found" }, 404);
        }
        return json({ ok: true, status: "available", place: publicPlace(found) });
      }

      if (path === "/api/public/search-status") {
        const q = url.searchParams.get("q") || "";
        if (!q.trim()) return json({ error: "q is required" }, 400);

        const places = await getPlaces(env);
        const found = findExactPlace(places, q);

        if (!found) {
          return json({
            ok: true,
            status: "not_registered",
            message: "この施設はまだ登録されていません。調査リクエストを送信できます。"
          });
        }

        if (!isPublishReady(found)) {
          return json({
            ok: true,
            status: "checking",
            name: found.name || q,
            message: "現在、この施設の情報を確認中です。確認が完了すると利用できるようになります。"
          });
        }

        return json({
          ok: true,
          status: "available",
          place: publicPlace(found)
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
