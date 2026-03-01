/**
 * Centralized French copy constants for all user-facing strings.
 * Provides type-safe keys for consistent string references across components.
 */
export const fr = {
  // Dashboard
  dashboard: {
    title: "Tableau de bord",
    welcome: "Bienvenue sur ReportFlow",
    overview: "Vue d'ensemble de votre activité",
    noData: "Aucune donnée à afficher pour le moment.",
    recentDocuments: "Documents récents",
    recentReports: "Rapports récents",
    unresolvedConflicts: "Conflits non résolus",
    pipelineStatus: "Statut du pipeline",
    noDocuments: "Aucun document",
    noReports: "Aucun rapport",
  },

  // Pipeline statuses
  pipelineStatus: {
    uploaded: "Téléversé",
    ocr_processing: "OCR en cours",
    ocr_done: "OCR terminé",
    embedding: "Indexation",
    embedded: "Indexé",
    extracting: "Extraction",
    review_ready: "Prêt pour révision",
    failed: "Échoué",
  },

  // Documents
  documents: {
    title: "Documents",
    upload: "Téléverser un document",
    noDocuments: "Aucun document trouvé",
    noDocumentsDescription: "Commencez par téléverser votre premier document.",
    detectedTypes: {
      sustainability_report: "Rapport de durabilité",
      energy_bill: "Facture d'énergie",
      hr_report: "Rapport RH",
      financial_statement: "État financier",
      other: "Autre",
    },
  },

  // Observations
  observations: {
    title: "Observations",
    noObservations: "Aucune observation trouvée",
    noObservationsDescription: "Les observations apparaîtront après l'extraction de vos documents.",
    merge: "Fusionner",
    mergeSuccess: "Observations fusionnées avec succès",
    mergeError: "Erreur lors de la fusion des observations",
    status: {
      candidate: "Candidat",
      approved: "Approuvé",
      rejected: "Rejeté",
      superseded: "Remplacé",
      invalidated: "Invalidé",
    },
  },

  // Conflicts
  conflicts: {
    title: "Conflits",
    noConflicts: "Aucun conflit détecté",
    noConflictsDescription: "Les conflits apparaîtront quand des données contradictoires sont détectées.",
    resolved: "Résolu",
    unresolved: "Non résolu",
  },

  // Reports
  reports: {
    title: "Rapports",
    noReports: "Aucun rapport généré",
    noReportsDescription: "Les rapports sont générés à partir de vos observations validées.",
    generate: "Générer un rapport",
    status: {
      draft: "Brouillon",
      final: "Final",
    },
  },

  // Chat
  chat: {
    title: "Chat",
    newSession: "Nouvelle conversation",
    noSessions: "Aucune conversation",
    noSessionsDescription: "Démarrez une conversation avec l'assistant IA.",
    placeholder: "Écrivez votre message...",
  },

  // Settings
  settings: {
    title: "Paramètres",
    companyName: "Nom de l'entreprise",
    companyNamePlaceholder: "Entrez le nom de l'entreprise",
    companyNameUpdated: "Nom de l'entreprise mis à jour",
    companyNameError: "Erreur lors de la mise à jour du nom",
    companySaved: "Nom de l'entreprise enregistré",
    preferences: "Préférences",
    preferencesDescription: "Gérez vos préférences de rapport et de style.",
    preferencesDeleted: "Préférences supprimées",
    preferencesCleared: "Toutes les préférences ont été supprimées",
    preferencesDeleteError: "Erreur lors de la suppression des préférences",
    preferencesDeleteConfirm: "Êtes-vous sûr de vouloir supprimer toutes vos préférences ?",
    noPreferences: "Aucune préférence enregistrée",
    clearPreferences: "Supprimer tout",
    clearPreferencesTitle: "Supprimer les préférences",
    clearPreferencesDescription: "Cette action supprimera toutes vos préférences enregistrées. Cette action est irréversible.",
    team: "Gestion de l'équipe",
    teamManagement: "Gestion de l'équipe",
    teamDescription: "Gérez les utilisateurs et leurs rôles.",
    categories: "Catégories de documents",
    categoriesDescription: "Organisez vos documents par catégories.",
    categoryManagement: "Catégories",
    categoryDescription: "Organisez vos documents par catégories.",
    manageCategories: "Gérer les catégories",
    dangerZone: "Zone dangereuse",
    dangerDescription: "Actions irréversibles pour votre entreprise. Toutes les données seront définitivement supprimées.",
    dangerZoneDescription: "Actions irréversibles pour votre entreprise.",
    deleteAllData: "Supprimer toutes les données",
    deleteCompanyData: "Supprimer toutes les données",
    deleteCompanyDataDescription: "Cette action supprimera définitivement toutes les données de votre entreprise. Cette action est irréversible.",
    deleteCompanyDataConfirm: "Tapez le nom de votre entreprise pour confirmer",
    deleteCompanyDataSuccess: "Suppression des données en cours...",
    deleteCompanyDataError: "Erreur lors de la suppression des données",
    deleteConfirmTitle: "Confirmer la suppression",
    deleteConfirmDescription: "Cette action supprimera définitivement toutes les données de votre entreprise. Cette action est irréversible.",
    confirmCompanyName: "Tapez le nom de votre entreprise pour confirmer",
    confirmDelete: "Supprimer définitivement",
    deletionStarted: "Suppression des données en cours...",
    unauthorized: "Vous n'avez pas accès aux paramètres.",
  },

  // Users
  users: {
    title: "Utilisateurs",
    invite: "Inviter un utilisateur",
    inviteTitle: "Inviter un utilisateur",
    noUsers: "Aucun utilisateur trouvé",
    empty: "Aucun utilisateur trouvé",
    email: "Adresse e-mail",
    role: "Rôle",
    actions: "Actions",
    roleUpdated: "Rôle mis à jour",
    roleUpdateError: "Erreur lors de la mise à jour du rôle",
    userDeleted: "Utilisateur supprimé",
    deleted: "Utilisateur supprimé",
    userDeleteError: "Erreur lors de la suppression",
    userCreated: "Utilisateur créé",
    created: "Utilisateur créé",
    userCreateError: "Erreur lors de la création",
    confirmDelete: "Êtes-vous sûr de vouloir supprimer cet utilisateur ?",
    deleteTitle: "Supprimer l'utilisateur",
    deleteDescription: "Êtes-vous sûr de vouloir supprimer l'utilisateur {email} ?",
    lastAdminError: "Impossible de modifier le dernier administrateur",
    cannotDeleteSelf: "Vous ne pouvez pas supprimer votre propre compte",
    emailExists: "Cette adresse e-mail est déjà utilisée",
    emailOtherCompany: "Cette adresse e-mail appartient à une autre entreprise",
    roles: {
      admin: "Administrateur",
      editor: "Éditeur",
      viewer: "Lecteur",
    },
  },

  // Notifications
  notifications: {
    title: "Notifications",
    noNotifications: "Aucune notification",
    markAllRead: "Tout marquer comme lu",
    types: {
      pipeline_completed: "Pipeline terminé",
      pipeline_failed: "Pipeline échoué",
      conflict_detected: "Conflit détecté",
      report_ready: "Rapport prêt",
      manual_obs_requested: "Observation demandée",
    },
  },

  // Categories
  categories: {
    title: "Catégories",
    create: "Nouvelle catégorie",
    createTitle: "Créer une catégorie",
    createChildTitle: "Ajouter une sous-catégorie",
    renameTitle: "Renommer la catégorie",
    rename: "Renommer",
    delete: "Supprimer",
    addChild: "Ajouter une sous-catégorie",
    confirmDelete: "Confirmer la suppression",
    nameRequired: "Le nom est requis",
    nameLabel: "Nom de la catégorie",
    namePlaceholder: "Entrez un nom",
    nameTooLong: "Le nom ne doit pas dépasser 100 caractères",
    maxDepth: "Profondeur maximale atteinte",
    empty: "Aucune catégorie. Créez-en une pour organiser vos documents.",
    hasChildren: "Impossible de supprimer : des sous-catégories existent",
    hasChildrenError: "Impossible de supprimer : des sous-catégories existent",
    hasDocuments: "Impossible de supprimer : des documents sont assignés",
    hasDocumentsError: "Impossible de supprimer : des documents sont assignés à cette catégorie",
    mixedParentsError: "Les catégories sélectionnées n'ont pas le même parent",
    reorderSuccess: "Ordre mis à jour",
    reorderError: "Erreur lors de la réorganisation",
    created: "Catégorie créée",
    renamed: "Catégorie renommée",
    deleted: "Catégorie supprimée",
    createError: "Erreur lors de la création",
    renameError: "Erreur lors du renommage",
    deleteError: "Erreur lors de la suppression",
  },

  // Onboarding
  onboarding: {
    welcome: {
      title: "Bienvenue sur ReportFlow !",
      description: "Commencez par téléverser votre premier document ESG.",
      cta: "Téléverser un document",
    },
    extraction: {
      title: "Extraction terminée !",
      description: "Vos observations ont été extraites. Révisez-les pour validation.",
      cta: "Voir les observations",
    },
    report: {
      title: "Votre premier rapport est prêt !",
      description: "Consultez et téléchargez votre rapport ESG généré.",
      cta: "Voir le rapport",
    },
    dismiss: "Fermer",
  },

  // Errors
  errors: {
    title: "Erreur",
    generic: "Une erreur est survenue",
    unauthorized: "Authentification requise",
    forbidden: "Accès interdit",
    notFound: "Ressource introuvable",
    validationError: "Erreur de validation",
    internalError: "Erreur interne du serveur",
    rateLimited: "Trop de requêtes, veuillez réessayer",
    networkError: "Erreur réseau, vérifiez votre connexion",
    retry: "Réessayer",
    support: "Contacter le support",
    contactSupport: "Contacter le support",
  },

  // Form validation
  validation: {
    required: "Ce champ est requis",
    email: "Adresse e-mail invalide",
    emailInvalid: "Adresse e-mail invalide",
    tooShort: "Trop court",
    tooLong: "Trop long",
    maxLength: "Ne doit pas dépasser {max} caractères",
    invalidFormat: "Format invalide",
  },

  // Common
  common: {
    save: "Enregistrer",
    cancel: "Annuler",
    delete: "Supprimer",
    edit: "Modifier",
    create: "Créer",
    confirm: "Confirmer",
    loading: "Chargement...",
    noResults: "Aucun résultat",
    search: "Rechercher",
    actions: "Actions",
    status: "Statut",
    date: "Date",
    name: "Nom",
    description: "Description",
    previous: "Précédent",
    next: "Suivant",
    page: "Page",
    of: "sur",
    manage: "Gérer",
    retry: "Réessayer",
  },

  // Clients
  clients: {
    title: "Clients",
    create: "Nouveau client",
    noClients: "Aucun client trouvé",
    noClientsDescription: "Commencez par créer votre premier client.",
    created: "Client créé",
    updated: "Client mis à jour",
    deleted: "Client supprimé",
    createError: "Erreur lors de la création du client",
    updateError: "Erreur lors de la mise à jour du client",
    deleteError: "Erreur lors de la suppression du client",
    hasReports: "Impossible de supprimer : des rapports sont associés à ce client",
    confirmDelete: "Êtes-vous sûr de vouloir supprimer ce client ?",
  },
} as const;

export type FrenchMessages = typeof fr;
