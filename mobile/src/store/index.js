import { configureStore, createSlice } from "@reduxjs/toolkit";

const domains = ["dashboard", "clubs", "loans", "messages", "members", "disputes", "settings", "validations", "notifications"];
const initialVersions = Object.fromEntries(domains.map(domain => [domain, 0]));

const syncSlice = createSlice({
    name: "sync",
    initialState: { versions: initialVersions },
    reducers: {
        invalidate(state, action) {
            for (const domain of action.payload || []) state.versions[domain] = (state.versions[domain] || 0) + 1;
        },
    },
});

export const { invalidate } = syncSlice.actions;
export const store = configureStore({ reducer: { sync: syncSlice.reducer } });
