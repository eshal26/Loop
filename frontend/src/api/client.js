const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        Object.defineProperty(this, "status", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.status = status;
    }
}
async function request(path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body.error || `Request failed: ${res.status}`, res.status);
    }
    if (res.status === 204)
        return undefined;
    return res.json();
}
export const api = {
    tasks: {
        list: (params) => {
            const qs = new URLSearchParams(params).toString();
            return request(`/tasks${qs ? `?${qs}` : ""}`);
        },
        update: (id, data) => request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
        delete: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
        create: (data) => request("/tasks", { method: "POST", body: JSON.stringify(data) }),
    },
    sessions: {
        create: (transcript) => request("/sessions", { method: "POST", body: JSON.stringify({ transcript }) }),
        list: () => request("/sessions"),
    },
};
