export function money(value, currency = "CDF") {
    return new Intl.NumberFormat("fr-CD", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}
export function shortDate(value) {
    return new Intl.DateTimeFormat("fr-CD", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
export function shortDateTime(value) {
    return new Intl.DateTimeFormat("fr-CD", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa",
    }).format(new Date(value));
}
export function greeting(now = new Date()) {
    const parts = new Intl.DateTimeFormat("fr-CD", { hour: "2-digit", hourCycle: "h23", timeZone: "Africa/Kinshasa" }).formatToParts(now);
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
    if (hour < 5) return "Bonsoir";
    if (hour < 12) return "Bonjour";
    if (hour < 18) return "Bon apres-midi";
    return "Bonsoir";
}
export const statusLabels = {
    not_submitted: "Non soumis",
    active: "Actif", current: "En cours", late: "En retard", repaid: "Remboursé",
    submitted: "Soumis", approved: "Validé", pending: "En attente", validated: "Validé",
    rejected: "Refusé", draft: "Brouillon", paid: "Payé", partial: "Partiel", upcoming: "À venir",
    open: "Ouvert", review: "En analyse", resolved: "Résolu", closed: "Clos", frozen: "Gelé",
    pending_partners: "Accords en attente", accepted: "Accepte", declined: "Refuse",
};
