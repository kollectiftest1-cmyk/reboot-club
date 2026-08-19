<!-- Version Markdown dérivée du cahier des charges PDF fourni. -->

> **Statut du document : Cahier des charges validé.**  
> Les ajustements demandés ont été intégrés aux sections **4.3 Prêteur**, **4.4 Emprunteur** et **08 Règles de gestion**.

# CAHIER DES CHARGES
## APPLICATION MOBILE DE GESTION DE CLUBS D’ÉPARGNE ET DE CRÉDIT
Gestion des membres, dépôts, prêts, remboursements, intérêts, pénalités et gouvernance des
clubs
---
**Nom du projet :** À compléter  
**Porteur du projet :** À compléter  
**Version du document :** 1.0  
**Date :** 31 juillet 2026  
**Statut :** Cahier des charges validé  

> DOCUMENT CONFIDENTIEL - USAGE PROJET

# 00 INFORMATIONS ET VALIDATION DU DOCUMENT
Ce cahier des charges formalise les besoins fonctionnels et les orientations techniques d’une application destinée
à organiser des clubs locaux d’épargne et de crédit. Il transforme la proposition initiale de profils et de
fonctionnalités en exigences structurées, testables et exploitables par une équipe de conception, de
développement et de validation.
**Important —** Les taux d’intérêt, commissions, pénalités, plafonds, délais, règles de retrait, formules de
calcul et circuits de validation doivent être confirmés avant le développement. Les valeurs citées dans ce
document sont configurables et ne constituent pas encore des règles contractuelles définitives.
### Historique des versions
Version Date Auteur / responsable Évolution
## 1.0 31/07/2026 À compléter Première formalisation du
besoin
— — — Révision après atelier de
validation
### Visa et approbation
Rôle Nom Date Signature
Porteur du projet À compléter — —
Responsable métier À compléter — —
Responsable technique À compléter — —

# 01 RÉSUMÉ EXÉCUTIF
L’application permettra de créer et d’administrer plusieurs clubs d’épargne-crédit, chacun regroupant des
membres pouvant déposer des fonds, financer des prêts, demander un crédit, suivre des échéances et consulter
un historique financier transparent. La plateforme sera organisée autour de quatre profils principaux :
administrateur, chef de club, prêteur et emprunteur. Deux profils complémentaires pourront être activés à mesure
que le réseau grandit : observateur/investisseur passif et médiateur/comité de gestion.
### Résultats attendus
- Centraliser les membres, les clubs, les dépôts, les prêts, les remboursements et les pénalités.
- Réduire les erreurs de suivi manuel et améliorer la traçabilité des opérations.
- Donner à chaque profil une vue claire et limitée à ses droits.
- Automatiser les échéanciers, alertes, calculs, états et historiques.
- Renforcer la confiance grâce à l’audit, aux règles visibles et à la transparence financière.
- Préparer une croissance vers plusieurs clubs, plusieurs responsables et un volume plus important de
transactions.
### Périmètre fonctionnel synthétique
Domaine Fonctions principales
Gouvernance Clubs, responsables, règles, permissions, commissions, litiges et
audit
Membres Adhésion, invitation, validation, statut, identité et score interne
Épargne / dépôts Enregistrement, validation, disponibilité des fonds et historique
Crédit Demande, étude, décision, décaissement, échéancier et suivi
Remboursement Paiements, retards, pénalités, solde restant et clôture
Communication Annonces, messages privés, SMS, notifications push et rappels
Pilotage Tableaux de bord, rapports, indicateurs, exports et journaux
d’activité

# 02 CONTEXTE, VISION ET OBJECTIFS
## 2.1 Contexte
Dans un environnement où les mécanismes d’épargne communautaire et de crédit reposent souvent sur la
confiance, le cash, les échanges de messages et des registres manuels, la croissance d’un club augmente
rapidement les risques d’erreurs, de conflits, d’oubli d’échéance et de manque de visibilité. L’application doit
constituer un registre numérique commun, sécurisé et compréhensible par les responsables, investisseurs et
emprunteurs.
## 2.2 Vision produit
Mettre à disposition une plateforme simple, fiable et évolutive qui facilite le financement de proximité tout en
conservant une gouvernance claire : qui apporte les fonds, qui demande un prêt, qui valide, combien reste à
payer, quels intérêts sont générés et quelles opérations ont été effectuées.
## 2.3 Objectifs métier
- Permettre à un administrateur de superviser tous les clubs et d’intervenir en cas de fraude, litige ou anomalie.
- Permettre à un chef de club d’animer son groupe, recruter, collecter et suivre les opérations quotidiennes.
- Permettre au prêteur de suivre le capital mis à disposition, les prêts financés et les intérêts gagnés.
- Permettre à l’emprunteur de comprendre ses engagements, ses échéances, ses pénalités et son historique
de crédit.
- Rendre les règles du club lisibles et calculables par le système.
- Maintenir un historique complet de toutes les actions sensibles.
## 2.4 Principes directeurs
Principe Traduction dans l’application
Simplicité Écrans courts, montants lisibles, actions guidées et vocabulaire
direct.
Transparence Historique, statuts, règles et soldes accessibles selon le rôle.
Contrôle Double validation configurable, journal d’audit et droits par profil.
Sécurité Identité vérifiée, OTP, sessions protégées, permissions strictes.
Évolutivité Gestion de plusieurs clubs, rôles délégués et paramètres
configurables.
Contexte local Compatibilité téléphones modestes, réseau lent et paiements
Mobile Money.

# 03 PÉRIMÈTRE DU PROJET
## 3.1 Inclus dans le périmètre initial
- Application mobile avec tableaux de bord personnalisés par rôle.
- Création, validation, suspension et consultation des clubs et comptes.
- Gestion des adhésions, membres, statuts et invitations.
- Enregistrement et validation des dépôts des prêteurs.
- Demande, analyse, validation, refus et suivi des prêts.
- Génération des échéanciers, enregistrement des remboursements et calcul des soldes.
- Gestion configurable des intérêts, commissions et pénalités.
- Notifications, rappels, annonces et messages ciblés.
- Rapports, statistiques, historique et journal d’audit.
- Gestion des litiges et demandes de retrait.
- Intégration Mobile Money, sous réserve du choix d’un prestataire et de l’obtention des accès nécessaires.
- Mode hors ligne partiel pour la consultation de données déjà synchronisées.
## 3.2 Éléments recommandés mais à confirmer
- Back-office web pour l’administration globale et l’analyse détaillée.
- Vérification d’identité renforcée avec pièce et selfie.
- Score interne de crédit et bulletin de fiabilité.
- Classement ou niveaux de prêteurs.
- Médiateur ou comité de gestion avec pouvoirs limités.
- Vidéos et fiches de formation intégrées.
- Export PDF/Excel des rapports et relevés.
## 3.3 Hors périmètre par défaut
Sauf décision contraire, le projet ne couvre pas : la gestion physique du cash, le transport de fonds, l’octroi
automatique sans validation humaine, la garantie publique des crédits, la tenue comptable réglementaire d’une
banque, ni la conformité juridique complète à une activité financière réglementée. Ces aspects doivent faire l’objet
d’une étude légale et opérationnelle séparée.

# 04 ACTEURS, PROFILS ET RESPONSABILITÉS
## 4.1 Administrateur global / fondateur
L’administrateur dispose d’une vision globale de la plateforme. Il contrôle les clubs, les comptes, les règles
générales et les opérations nécessitant une validation ou une intervention de niveau supérieur.
- Voir tous les clubs, leurs responsables, leurs membres et leurs indicateurs.
- Accepter ou refuser les nouvelles adhésions selon le circuit de validation retenu.
- Suspendre, bloquer ou supprimer un compte en cas de fraude ou de problème grave.
- Valider les dépôts des prêteurs lorsque la réception des fonds doit être confirmée.
- Valider les demandes de prêt selon les règles configurées.
- Définir les montants minimum/maximum, durées, taux, commissions et pénalités.
- Consulter les statistiques globales, rapports, réclamations et journaux d’audit.
- Geler un club ou une opération en cas de litige.
## 4.2 Chef de club
Le chef de club gère un groupe local et ses activités quotidiennes. Il ne voit que son club, sauf délégation
particulière.
- Recruter des membres et envoyer des invitations par lien, SMS ou messagerie.
- Vérifier et prévalider les demandes d’adhésion.
- Voir la liste des membres et leur statut : actif, bloqué, en retard, prêteur ou emprunteur.
- Enregistrer les dépôts des prêteurs et les remboursements des emprunteurs.
- Envoyer des annonces au club et des messages privés.
- Consulter les montants disponibles, les prêts en cours, remboursés ou en retard.
- Appliquer les pénalités selon les règles du club.
- Produire des rapports mensuels et proposer de nouveaux prêts.
- Déléguer certaines tâches à un adjoint ou trésorier, si cette option est activée.
## 4.3 Prêteur / investisseur du club
- Lorsqu’une demande de prêt est soumise, le prêteur peut consulter les informations autorisées de la demande et choisir librement de participer à son financement, dans la limite de son capital disponible et des règles du club.
- Voir le capital actif mis à disposition du club.
- Voir le nombre de membres du club et les prêts financés.
- Suivre les intérêts gagnés par prêt, période et cumul.
- Consulter le nombre de prêts accordés, refusés, en cours et remboursés.
- Consulter l’historique de ses dépôts et leurs statuts.
- Demander un retrait partiel ou total, selon les règles du club.
- Simuler le rendement potentiel d’un dépôt.
- Recevoir des notifications lorsqu’un prêt financé est remboursé ou lorsqu’un intérêt est crédité.
- Voir, de façon anonymisée, les catégories de projets financés.
## 4.4 Emprunteur
- Avant de soumettre une demande de prêt, l’emprunteur peut effectuer une simulation afin de connaître le montant emprunté, les intérêts, les frais éventuels, les échéances et le montant total exact à rembourser selon les paramètres applicables.
- Voir les membres du groupe et les informations autorisées sur le club.
- Consulter ses prêts en cours : montant initial, montant remboursé, reste à payer, échéance et taux.
- Consulter ses pénalités et leur détail de calcul.
- Voir l’historique des prêts accordés, refusés, en cours et remboursés.
- Soumettre une demande de prêt avec montant, durée, motif, revenu estimé et garants.
- Suivre l’état de la demande et le motif d’un refus.
- Consulter son calendrier de remboursement et payer en une ou plusieurs fois.
- Recevoir des alertes avant échéance et en cas de retard imminent.
- Consulter son score interne et son bulletin de crédit, si activés.
## 4.5 Profils complémentaires
Profil Droits proposés

Observateur / investisseur passif Consulter ses dépôts, intérêts et historiques, sans voter ni
accéder aux informations sensibles.
Médiateur / comité de gestion Consulter les dossiers en litige, analyser les prêts importants et
proposer des décisions, sans remplacer l’administrateur.
Adjoint / trésorier de club Exécuter une partie des tâches du chef selon des permissions
fines et révocables.
# 05 ARCHITECTURE FONCTIONNELLE
Module Finalité Utilisateurs principaux
Authentification et identité Inscription, connexion, OTP, récupération,
KYC et biométrie Tous
Gestion des clubs Création, règles, responsable, statut, visibilité
et suspension Administrateur, chef
Adhésions et membres Invitation, demande, validation, affectation de
rôle et statut Administrateur, chef
Dépôts et capacité de prêt Enregistrer, confirmer et suivre les fonds
disponibles Administrateur, chef, prêteur
Demandes de prêt Soumettre, étudier, décider et décaisser Emprunteur, chef, administrateur
Remboursements Échéancier, paiement, retard, pénalité et
clôture Emprunteur, chef, administrateur
Retraits prêteurs Demande, contrôle des fonds engagés et
validation Prêteur, chef, administrateur
Communication Messages privés, annonces, SMS, push et
rappels Tous selon rôle
Litiges Réclamations, pièces, médiation, décision et
gel Chef, médiateur, administrateur
Pilotage et audit Indicateurs, rapports, exports, historique et
logs Chef, administrateur
**Lecture fonctionnelle —** Chaque opération financière doit produire au minimum : un identifiant unique, un
montant, une devise, une date, un auteur, un statut, un club concerné et une trace de validation.

# 06 EXIGENCES FONCTIONNELLES DÉTAILLÉES
## 6.1 Authentification, compte et identité
ID Exigence
FR-AUTH-01 Permettre l’inscription par numéro de téléphone avec code OTP.
FR-AUTH-02 Permettre l’inscription ou la connexion par e-mail et mot de
passe, si activée.
FR-AUTH-03 Permettre la récupération d’accès par OTP ou e-mail.
FR-AUTH-04 Permettre la vérification d’identité avec pièce, photo et selfie,
selon le niveau requis.
FR-AUTH-05 Permettre l’activation de la biométrie sur les appareils
compatibles.
FR-AUTH-06 Gérer les sessions, déconnexions à distance et blocages après
tentatives anormales.
FR-AUTH-07 Afficher et faire accepter les conditions d’utilisation et la politique
de confidentialité.
## 6.2 Gestion des clubs
ID Exigence
FR-CLUB-01 Créer un club avec nom, description, zone, responsable, devise,
règles et statut.
FR-CLUB-02 Afficher les règles internes : taux, durées, plafonds, pénalités,
retraits et validations.
FR-CLUB-03 Activer, suspendre, archiver ou geler un club.
FR-CLUB-04 Afficher le nombre de membres, les fonds disponibles et les
indicateurs du club.
FR-CLUB-05 Affecter un chef de club et, si activé, des responsables adjoints.
FR-CLUB-06 Empêcher un chef de club d’accéder aux clubs qu’il ne gère pas.
## 6.3 Adhésions et membres
ID Exigence
FR-MEM-01 Inviter un membre par lien, code, SMS ou partage via
messagerie.
FR-MEM-02 Soumettre une demande d’adhésion contenant les informations
obligatoires.
FR-MEM-03 Prévalider l’adhésion au niveau du club et effectuer la validation
finale selon le circuit configuré.
FR-MEM-04 Attribuer un ou plusieurs rôles compatibles : prêteur, emprunteur,
responsable.
FR-MEM-05 Afficher le statut : en attente, actif, bloqué, suspendu, sorti ou en
retard.

FR-MEM-06 Conserver l’historique des changements de rôle et de statut.
FR-MEM-07 Empêcher la suppression définitive d’un membre ayant des
opérations financières ; privilégier l’archivage.
## 6.4 Dépôts et fonds disponibles
ID Exigence
FR-DEP-01 Enregistrer un dépôt avec montant, devise, date, moyen de
paiement, preuve et prêteur.
FR-DEP-02 Gérer les statuts : brouillon, en attente, validé, refusé, annulé.
FR-DEP-03 Ne rendre le montant disponible pour prêt qu’après validation.
FR-DEP-04 Calculer le capital actif, le capital engagé, le capital libre et le
capital en retrait.
FR-DEP-05 Afficher l’historique des dépôts par prêteur et par club.
FR-DEP-06 Notifier le prêteur lors de chaque changement de statut.
FR-DEP-07 Empêcher une validation en double ou une modification non
tracée du montant.
## 6.5 Demandes et décisions de prêt
ID Exigence
FR-LOAN-01 Permettre à l’emprunteur de renseigner montant, durée, motif,
revenu estimé, garants et pièces.
FR-LOAN-02 Vérifier automatiquement les plafonds, la capacité du club, les
prêts actifs et les restrictions.
FR-LOAN-03 Afficher au décideur le profil, le score interne, l’historique, les
retards et les garanties.
FR-LOAN-04 Gérer les statuts : brouillon, soumis, en étude, validé, refusé,
décaissé, en cours, en retard, remboursé, litigieux, annulé.
FR-LOAN-05 Exiger un motif lors du refus ou de l’annulation.
FR-LOAN-06 Générer le contrat/récapitulatif et l’échéancier après validation.
FR-LOAN-07 Affecter les fonds d’un ou plusieurs prêteurs selon une règle à
définir.
FR-LOAN-08 Tracer chaque validation, modification et décaissement.
FR-LOAN-09 Notifier l’emprunteur, le chef et les prêteurs concernés.
## 6.6 Remboursements, intérêts et pénalités
ID Exigence
FR-REP-01 Générer les échéances avec principal, intérêt, frais éventuels et
total dû.
FR-REP-02 Accepter un remboursement complet ou partiel, selon les règles
du club.

FR-REP-03 Calculer après chaque paiement le principal restant, les intérêts
dus et les pénalités.
FR-REP-04 Gérer les paiements en avance et le recalcul éventuel des
intérêts selon la méthode choisie.
FR-REP-05 Détecter automatiquement une échéance impayée et passer le
prêt en retard.
FR-REP-06 Appliquer une pénalité configurable, avec détail du calcul visible.
FR-REP-07 Clôturer le prêt uniquement lorsque toutes les sommes exigibles
sont réglées ou annulées par décision autorisée.
FR-REP-08 Réallouer aux prêteurs le capital et les intérêts selon la règle de
répartition.
FR-REP-09 Produire un reçu et une notification après chaque
remboursement.
## 6.7 Demandes de retrait du prêteur
ID Exigence
FR-WD-01 Permettre une demande de retrait partiel ou total.
FR-WD-02 Vérifier le capital libre, les montants engagés, le préavis et les
plafonds.
FR-WD-03 Gérer les statuts : soumise, en étude, validée, refusée, payée,
annulée.
FR-WD-04 Afficher le motif de refus et la date estimée de disponibilité.
FR-WD-05 Tracer la décision et le paiement du retrait.
## 6.8 Communication et notifications
ID Exigence
FR-NOT-01 Envoyer des annonces à tous les membres d’un club.
FR-NOT-02 Envoyer un message privé à un membre pour relance ou
explication.
FR-NOT-03 Déclencher des notifications push et/ou SMS pour les
événements importants.
FR-NOT-04 Prévoir des rappels avant échéance, le jour de l’échéance et
après retard.
FR-NOT-05 Conserver un historique d’envoi, de réception et, si possible, de
lecture.
FR-NOT-06 Permettre à l’administrateur d’envoyer une annonce globale à
tous les clubs.
## 6.9 Litiges et réclamations
ID Exigence
FR-DIS-01 Ouvrir une réclamation liée à un dépôt, un prêt, un
remboursement ou un retrait.

FR-DIS-02 Ajouter une description, des pièces et des messages au dossier.
FR-DIS-03 Affecter le dossier à un chef, médiateur ou administrateur.
FR-DIS-04 Permettre le gel temporaire d’une opération ou d’un compte,
avec motif obligatoire.
FR-DIS-05 Enregistrer la décision : rééchelonnement, correction, réduction
de pénalité, rejet ou autre mesure autorisée.
FR-DIS-06 Conserver l’historique intégral du dossier jusqu’à sa clôture.
## 6.10 Rapports, statistiques et audit
ID Exigence
FR-REPOT-01 Afficher le nombre de clubs, membres, prêteurs, emprunteurs et
comptes bloqués.
FR-REPOT-02 Afficher les montants déposés, disponibles, engagés, prêtés,
remboursés et en retard.
FR-REPOT-03 Calculer les intérêts générés, pénalités et commissions par
période.
FR-REPOT-04 Calculer le taux de remboursement et le taux de défaut global et
par club.
FR-REPOT-05 Produire un rapport mensuel par club et une synthèse globale.
FR-REPOT-06 Permettre le filtrage par club, membre, statut, période et type
d’opération.
FR-REPOT-07 Conserver un journal d’audit : auteur, action, date, appareil,
ancienne et nouvelle valeur.
FR-REPOT-08 Exporter les états en PDF et, si retenu, en Excel/CSV.

# 07 PARCOURS ET WORKFLOWS PRINCIPAUX
## 7.1 Adhésion à un club
1. Invitation ou sélection du club
2. Création/connexion du compte
3. Saisie des informations et pièces
4. Prévalidation par le chef de club
5. Validation finale selon le paramétrage
6. Activation du membre et attribution du rôle
7. Notification et accès au tableau de bord
## 7.2 Dépôt d’un prêteur
1. Saisie ou enregistrement du dépôt
2. Ajout du moyen de paiement et de la preuve
3. Statut « en attente »
4. Contrôle du responsable autorisé
5. Validation ou refus motivé
6. Mise à jour du capital disponible
7. Notification et inscription au journal d’activité
## 7.3 Demande de prêt
1. Saisie de la demande
2. Contrôles automatiques d’éligibilité
3. Analyse du dossier et des garanties
4. Préavis/proposition du chef de club
5. Validation finale ou refus motivé
6. Affectation des fonds et décaissement
7. Génération de l’échéancier
8. Suivi jusqu’au remboursement complet
## 7.4 Remboursement et retard
1. Rappel avant échéance
2. Paiement ou enregistrement par le chef
3. Validation du paiement
4. Répartition principal/intérêt/frais
5. Mise à jour du solde
6. Si impayé : passage en retard et calcul de pénalité
7. Relance, litige ou rééchelonnement éventuel
8. Clôture après règlement complet
## 7.5 Retrait d’un prêteur
1. Demande de retrait
2. Contrôle du capital libre et du préavis
3. Validation, refus ou programmation
4. Paiement du retrait
5. Mise à jour du capital actif et de l’historique

**Point de contrôle —** Aucun changement de statut financier ne doit être possible sans droit approprié,
motif lorsque requis et trace d’audit.
# 08 RÈGLES DE GESTION
ID Règle
RG-01 Un utilisateur ne voit que les clubs et données autorisés par son
rôle.
RG-02 Un dépôt en attente ou refusé ne peut pas augmenter la capacité
de prêt.
RG-03
Un prêt ne peut être validé au-delà du capital réellement
disponible, sauf mécanisme explicite de réservation ou
cofinancement.
RG-04 Tout refus, blocage, annulation, gel ou correction financière exige
un motif.
RG-05 Les montants et calculs doivent être arrondis selon une règle
unique à définir.
RG-06 Les taux, durées, plafonds, commissions et pénalités sont
paramétrables par niveau autorisé.
RG-07 Une opération validée ne doit pas être supprimée ; elle doit être
annulée ou contrepassée avec traçabilité.
RG-08 Un membre ayant un prêt actif ne peut pas quitter définitivement
le club sans règlement ou décision autorisée.
RG-09 Le capital engagé dans un prêt est bloqué pendant une durée de 1 ou 2 mois, selon la règle applicable au prêt. Il n’est pas retirable pendant cette période.
RG-10 Les informations d’un emprunteur visibles aux prêteurs doivent
être limitées et, lorsque possible, anonymisées.
RG-11 Chaque échéance possède un statut : à venir, due, partiellement
payée, payée, en retard, annulée.
RG-12 Le score interne est explicable, basé sur des critères validés et
ne décide pas seul de l’octroi.
RG-13 Les commissions doivent être comptabilisées séparément du
principal et des intérêts.
RG-14 La devise de chaque opération doit être explicite ; les règles de
conversion éventuelle sont à définir.
RG-15 Les données hors ligne sont synchronisées dès le retour du
réseau et les conflits sont signalés.
### Valeurs métier à confirmer
Paramètre Exemple ou orientation Décision attendue
Commission globale Exemple initial : 10 % Confirmer le taux, l’assiette et le bénéficiaire
Taux d’intérêt Minimum/maximum configurable Définir méthode : fixe, dégressif, périodique
Durée du prêt Minimum/maximum configurable Définir unité et limites
Montant du prêt Minimum/maximum configurable Définir par club ou par profil

Pénalité de retard Exemple : 5 % par semaine Confirmer fréquence, plafond et base de
calcul
Retrait prêteur Préavis et plafond mensuel Définir délais et exceptions
Paiement anticipé Autorisé avec recalcul éventuel Définir formule
Double validation Chef puis administrateur Confirmer selon montant et type d’opération
# 09 MATRICE DES PERMISSIONS
Fonction Admin Chef de club Prêteur Emprunteur Médiateur
Voir tous les clubs Oui Non Non Non Selon mandat
Gérer son club Oui Oui Non Non Non
Valider adhésion Finale/config. Prévalidation Non Non Non
Enregistrer dépôt Oui Oui Proposer Non Non
Valider dépôt Oui/config. Selon droit Non Non Non
Demander prêt Non Proposer Non Oui Non
Valider prêt Oui/config. Préavis/config. Non Non Avis
Enregistrer
remboursement Oui Oui Non Payer Non
Demander retrait Non Non Oui Non Non
Gérer litige Oui Premier niveau Ouvrir Ouvrir Proposer
Voir rapports globaux Oui Son club Ses fonds Ses prêts Dossiers affectés
Modifier règles Oui Limité/config. Non Non Non
**À valider —** Cette matrice propose un partage cohérent des responsabilités. Les permissions finales
doivent être confirmées lors d’un atelier métier, notamment pour les validations de dépôts et de prêts.

# 10 DONNÉES ET RÉFÉRENTIEL
## 10.1 Entités principales
Entité Données principales
Utilisateur Identité, contacts, statut, KYC, préférences, appareils, rôles
Club Nom, description, zone, devise, règles, responsable, statut
Adhésion Club, utilisateur, rôle, date, statut, décisions
Dépôt Prêteur, club, montant, devise, moyen, preuve, statut, validations
Demande de prêt Emprunteur, motif, montant, durée, revenu, garants, pièces, statut
Prêt Capital, taux, commissions, dates, échéancier, fonds affectés, statut
Échéance Date, principal, intérêt, frais, pénalité, payé, solde, statut
Remboursement Montant, date, canal, preuve, ventilation, validation
Retrait Prêteur, montant, demande, décision, paiement, statut
Litige Objet, opération, parties, pièces, messages, décision, statut
Notification Type, destinataire, canal, contenu, envoi, lecture
Audit Auteur, action, objet, date, ancienne/nouvelle valeur, contexte
## 10.2 Conservation et qualité des données
- Les identifiants financiers doivent être uniques et non réutilisables.
- Les dates et heures doivent être stockées avec fuseau horaire.
- Les preuves et pièces doivent être protégées et accessibles uniquement aux profils autorisés.
- Les données sensibles ne doivent pas apparaître dans les journaux techniques en clair.
- Les opérations financières validées doivent être conservées selon une durée définie avec le conseil juridique.
- Les sauvegardes doivent être testées régulièrement.

# 11 EXPÉRIENCE UTILISATEUR ET INTERFACES
## 11.1 Principes UX
- Accueil personnalisé selon le rôle et les actions prioritaires.
- Montants affichés avec devise, séparateurs lisibles et état clairement coloré.
- Navigation simple, compatible avec les écrans de taille moyenne et les téléphones peu puissants.
- Formulaires progressifs avec sauvegarde en brouillon.
- Confirmation explicite avant toute opération financière.
- Aide contextuelle sur les notions : intérêt, pénalité, capital disponible, échéance.
- Messages d’erreur compréhensibles, sans jargon technique.
- Accessibilité de base : contraste, taille de texte, zones tactiles suffisantes.
## 11.2 Écrans principaux
Profil Écrans prioritaires
Administrateur Vue globale, clubs, validations, règles, utilisateurs, litiges,
rapports, audit
Chef de club Tableau du club, membres, collecte, prêts, échéances,
messages, calendrier, rapport mensuel
Prêteur Capital, intérêts, dépôts, prêts financés, retrait, simulation,
notifications
Emprunteur Mes prêts, demande, échéancier, paiement, pénalités, historique,
score
Tous Profil, sécurité, notifications, activité, aide et support
## 11.3 Mode hors ligne partiel
L’utilisateur pourra consulter certaines informations déjà synchronisées, notamment son tableau de bord récent,
les échéances et l’historique limité. Les actions financières, validations et mises à jour critiques nécessiteront une
connexion, sauf mécanisme sécurisé explicitement conçu pour la saisie différée. Toute donnée non synchronisée
devra être clairement signalée.

# 12 EXIGENCES NON FONCTIONNELLES
Domaine Exigence cible
Performance Ouverture des écrans courants en moins de 3 secondes sur une
connexion mobile correcte, hors dépendances tierces.
Disponibilité Service conçu pour une disponibilité mensuelle cible à définir ;
maintenance planifiée annoncée.
Sécurité Chiffrement en transit, mots de passe hachés, gestion des sessions,
OTP, contrôle d’accès et audit.
Confidentialité Minimisation des données, consentement, accès limité aux pièces et
possibilité de traiter les demandes légitimes.
Fiabilité financière Calculs reproductibles, transactions atomiques, contrôles de double
saisie et rapprochements.
Scalabilité Architecture capable d’ajouter des clubs, membres et opérations sans
refonte complète.
Compatibilité Android prioritaire ; versions minimales et éventuel iOS à confirmer.
Réseau faible Compression, pagination, reprise après coupure et synchronisation
progressive.
Sauvegarde Sauvegardes automatiques chiffrées et procédure documentée de
restauration.
Observabilité Journaux techniques, alertes, suivi des erreurs et indicateurs de
santé.
Maintenabilité Code documenté, environnements séparés, gestion de versions et
tests automatisés.
Accessibilité Contraste suffisant, texte redimensionnable et libellés explicites.

# 13 ARCHITECTURE TECHNIQUE PROPOSÉE
**Nature de cette section —** Les choix ci-dessous sont des orientations techniques proposées pour rendre
le cahier des charges exploitable. Ils doivent être validés par l’équipe technique et adaptés au budget, au
volume attendu et aux prestataires disponibles.
## 13.1 Composants
Composant Rôle
Application mobile Interfaces des membres, notifications, stockage local sécurisé et
synchronisation.
API métier sécurisée Authentification, règles, calculs, contrôles, droits et exposition
des données.
Base de données relationnelle Clubs, utilisateurs, opérations, échéanciers, décisions et audit.
Stockage de fichiers Pièces d’identité, preuves, reçus et documents, avec accès signé
et contrôlé.
Service de notifications Push, SMS et éventuellement e-mail.
Passerelle de paiement Mobile Money et suivi des transactions, selon prestataire retenu.
Back-office web recommandé Administration globale, analyse, configuration et support.
Supervision et sauvegarde Logs, alertes, métriques, sauvegardes et restauration.
## 13.2 Environnements
- Développement
- Test / recette
- Préproduction, si nécessaire
- Production
## 13.3 Principes d’intégration
- Les intégrations externes doivent être isolées derrière des services dédiés.
- Chaque paiement doit avoir une référence interne et une référence du prestataire.
- Les notifications de paiement reçues du prestataire doivent être signées, vérifiées et idempotentes.
- Une opération externe non confirmée ne doit pas être comptabilisée comme définitive.
- Les secrets et clés d’API ne doivent jamais être intégrés dans l’application mobile.

# 14 SÉCURITÉ, CONFORMITÉ ET CONTRÔLE
## 14.1 Contrôles de sécurité
- Authentification OTP et politique de mot de passe adaptée.
- Biométrie locale facultative comme moyen de déverrouillage, sans remplacer l’identité serveur.
- Contrôle d’accès par rôle, club, opération et statut.
- Chiffrement HTTPS/TLS pour tous les échanges.
- Protection des données sensibles au repos et sur l’appareil.
- Expiration de session, révocation des appareils et alertes de connexion inhabituelle.
- Limitation de débit, protection contre les tentatives répétées et journalisation des actions sensibles.
- Revue des dépendances et correction régulière des vulnérabilités.
## 14.2 Contrôles financiers
- Double validation configurable pour les montants élevés ou opérations critiques.
- Idempotence afin d’éviter les doubles paiements ou doubles validations.
- Contrepassation plutôt que suppression des écritures validées.
- Rapprochement périodique entre paiements externes et écritures internes.
- Séparation des rôles entre saisie, validation et supervision lorsque le club le permet.
- Journal d’audit consultable et exportable par les personnes autorisées.
## 14.3 Conformité à valider
Le porteur du projet devra vérifier, avec un conseil compétent, les obligations applicables en RDC concernant
l’activité de crédit, la collecte de fonds, la protection des données, l’identification des clients, la lutte contre la
fraude et le blanchiment, la fiscalité, la conservation des preuves et les conditions contractuelles. Le logiciel ne
remplace pas cette validation juridique.

# 15 CRITÈRES DE RECETTE ET D’ACCEPTATION
La recette sera considérée comme concluante lorsque les scénarios prioritaires ci-dessous sont exécutés avec
succès dans l’environnement de test et que les anomalies bloquantes sont corrigées.
ID Scénario d’acceptation Résultat attendu
AC-01 Inscription et validation OTP Le compte est créé une seule fois, l’OTP expire
et les erreurs sont gérées.
AC-02 Création d’un club et règles Le club est visible par les bons profils avec ses
paramètres.
AC-03 Adhésion d’un membre Le circuit de validation, les notifications et le
statut sont corrects.
AC-04 Dépôt prêteur Le dépôt validé augmente exactement le capital
disponible.
AC-05 Demande de prêt Les contrôles, décisions, motifs et notifications
fonctionnent.
AC-06 Décaissement et échéancier Le prêt passe en cours et l’échéancier
correspond aux paramètres.
AC-07 Remboursement partiel La ventilation et le solde restant sont exacts.
AC-08 Retard et pénalité Le statut et la pénalité sont calculés selon la
règle configurée.
AC-09 Remboursement final Le prêt est clôturé et les fonds/intérêts sont
réaffectés.
AC-10 Retrait prêteur Le système empêche de retirer du capital
engagé.
AC-11 Blocage et litige Les actions sont limitées, motivées et auditées.
AC-12 Permissions Aucun profil ne consulte ou modifie une donnée
interdite.
AC-13 Réseau instable La consultation hors ligne et la reprise de
synchronisation sont cohérentes.
AC-14 Rapports Les totaux correspondent aux opérations de
test.
AC-15 Sauvegarde/restauration Une restauration de test récupère les données
attendues.

# 16 LIVRABLES ATTENDUS
- Cahier des charges validé et backlog des fonctionnalités.
- Maquettes UX/UI et prototype navigable des parcours prioritaires.
- Application mobile compilée et prête pour les tests de publication.
- Backend/API, base de données et interfaces d’administration retenues.
- Configuration des notifications et intégrations de paiement convenues.
- Jeux de tests, rapport de recette et registre des anomalies.
- Documentation technique : installation, configuration, sauvegarde et déploiement.
- Guide utilisateur par profil et guide d’administration.
- Code source, scripts de déploiement et inventaire des dépendances selon les modalités contractuelles.
- Formation des administrateurs et responsables de club.
- Plan de maintenance, support et évolution.

# 17 PHASAGE RECOMMANDÉ
Phase Contenu Sortie attendue
1. Cadrage Validation des règles, rôles, calculs,
intégrations et priorités Cahier des charges approuvé
2. UX/UI Parcours, architecture des écrans, maquettes
et prototype Prototype validé
3. Socle technique Authentification, utilisateurs, clubs,
permissions, audit Version interne du socle
4. Finance cœur Dépôts, prêts, échéanciers,
remboursements, pénalités Version fonctionnelle principale
5. Communication et rapports Notifications, messages, statistiques, exports Version bêta
6. Intégrations Mobile Money, SMS, stockage et outils
externes Version intégrée
7. Recette et sécurité Tests métier, permissions, performance et
corrections Version candidate
8. Déploiement Publication, formation, migration initiale et
assistance Mise en production
9. Stabilisation Suivi, correction, optimisation et bilan Version stabilisée
### Priorisation recommandée
Niveau Contenu
MVP / indispensable
Comptes, clubs, membres, dépôts, prêts, échéanciers,
remboursements, notifications essentielles, audit et rapports de
base.
Version 1 complète Retraits, litiges, Mobile Money, KYC renforcé, rapports avancés,
back-office et hors ligne partiel.
Évolutions Score avancé, gamification prêteur, comité, formations, analyses
prédictives et extensions multi-pays.

# 18 RISQUES, DÉPENDANCES ET MESURES
Risque / dépendance Impact Mesure recommandée
Règles métier non stabilisées Calculs et écrans à refaire Organiser un atelier de validation avant
développement.
Confusion entre rôles Fraude ou accès excessif Valider la matrice de permissions et tester
chaque rôle.
Gestion du cash hors système Écarts entre application et réalité Mettre en place preuves, validation et
rapprochement quotidien.
Prestataire Mobile Money Retard d’intégration Sélectionner tôt le partenaire et obtenir les
accès de test.
Réseau mobile instable Actions interrompues Prévoir reprise, idempotence et mode hors ligne
limité.
Données d’identité sensibles Risque juridique et réputationnel Minimiser, chiffrer, journaliser et limiter les
accès.
Calculs financiers incorrects Perte de confiance Tests unitaires, jeux de référence et validation
métier.
Croissance rapide Ralentissements Pagination, architecture scalable et supervision.
Fraude interne Pertes financières Séparation des tâches, double validation et
audit.
Faible adoption Retour aux registres manuels Formation, interface simple et accompagnement
terrain.

# 19 DÉCISIONS À PRENDRE AVANT LANCEMENT
1. Nom officiel, identité visuelle et propriétaire juridique de la plateforme.
2. Pays, zones et devise(s) de lancement.
3. Nature exacte du club : association interne, coopérative, plateforme d’intermédiation ou autre structure.
4. Circuit de validation des adhésions, dépôts, prêts, retraits et corrections.
5. Formule des intérêts et règles d’arrondi.
6. Commission de la plateforme et commission éventuelle du chef de club.
7. Méthode de répartition des prêts entre plusieurs prêteurs.
8. Pénalités, plafonds, délais de grâce et rééchelonnement.
9. Conditions de retrait des prêteurs.
10. Données KYC obligatoires et durée de conservation.
11. Canaux de paiement et prestataire Mobile Money.
12. Android uniquement ou Android + iOS ; nécessité d’un back-office web.
13. Langues de l’application et contenu des SMS.
14. Modèle économique, abonnement, frais par transaction ou autre.
15. Responsabilités opérationnelles en cas de défaut ou de litige.
16. Politique de support, maintenance et mises à jour.

# 20 CONCLUSION
Le projet vise à transformer un fonctionnement communautaire fondé sur la confiance en un système numérique
traçable, lisible et évolutif. La réussite dépendra moins du nombre d’écrans que de la précision des règles :
validation des fonds, décision de prêt, méthode d’intérêt, répartition des gains, gestion des retards et séparation
des responsabilités. Une fois ces règles validées, le présent document peut servir de base à la conception UX/UI,
à l’estimation, au développement, aux tests et au contrat de réalisation.
**Prochaine étape recommandée —** Organiser un atelier métier de validation des décisions listées à la
section 19, puis figer une version 1.1 du cahier des charges avant estimation définitive et développement.

# A GLOSSAIRE
Terme Définition
Capital actif Somme validée mise à disposition par un prêteur et non retirée.
Capital libre Part du capital disponible pour financer un nouveau prêt.
Capital engagé Part du capital déjà affectée à un prêt non totalement remboursé.
Principal Montant de base du prêt, hors intérêts, frais et pénalités.
Intérêt Rémunération calculée selon le taux et la méthode retenus.
Pénalité Montant ajouté en cas de retard ou de non-respect d’une règle.
Échéance Date et montant devant être payés dans le cadre d’un prêt.
Décaissement Mise à disposition effective des fonds à l’emprunteur.
KYC Procédure de connaissance et de vérification de l’identité du
membre.
OTP Code à usage unique envoyé pour confirmer l’identité ou une
action.
Audit Trace permettant de savoir qui a effectué une action, quand et
sur quoi.
Idempotence Mécanisme empêchant qu’une même demande produise deux
opérations identiques.
