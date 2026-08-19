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
export const statusLabels = {
    not_submitted: "Non soumis",
    active: "Actif", current: "En cours", late: "En retard", repaid: "Remboursé",
    submitted: "Soumis", approved: "Validé", pending: "En attente", validated: "Validé",
    rejected: "Refusé", draft: "Brouillon", paid: "Payé", partial: "Partiel", upcoming: "À venir",
    open: "Ouvert", review: "En analyse", resolved: "Résolu", closed: "Clos", frozen: "Gelé",
};
