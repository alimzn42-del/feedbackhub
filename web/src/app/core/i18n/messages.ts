/* ════════════════════════════════════════════════════════════════════════════
 *                              THE MESSAGE CATALOGUE
 *
 * Every string this application writes for itself, in the languages it offers.
 *
 * WHAT IS AND IS NOT IN HERE
 *
 * The interface chrome: navigation, headings, buttons, empty states, error
 * states, validation messages the browser side raises, and the words around
 * somebody else's content.
 *
 * NOT what people typed. Requests, comments, display names and the names of
 * categories and statuses are content, in whatever language their author wrote
 * them, and translating them would mean inventing words nobody said.
 *
 * NOT the settings screens' labels either — those come from the API, which
 * holds them in both languages next to the setting they describe. That keeps
 * the promise that adding a setting is one edit in one file: it would be a lie
 * if every new setting also needed two lines here.
 *
 * WHY A RUNTIME CATALOGUE AND NOT ANGULAR'S $localize
 *
 * Angular's own i18n is a build-time mechanism: one compiled bundle per locale,
 * chosen by the URL or the server. It produces smaller bundles and it cannot do
 * the thing this application needs, which is to change language because
 * somebody picked one from a list, without a reload, on a preference that
 * arrives from the API after the application has started.
 *
 * KEEPING THE TWO IN STEP
 *
 * `french` is typed against the English keys, so a missing or misspelled one is
 * a compile error rather than an English word appearing in a French sentence.
 * ══════════════════════════════════════════════════════════════════════════ */

const english = {
  /* ── Shell ─────────────────────────────────────────────────────────────── */
  'app.skipToContent': 'Skip to main content',
  'app.tagline': 'Internal product feedback',
  'app.starting': 'Starting FeedbackHub…',
  'app.startFailed': 'FeedbackHub could not start',
  'app.reference': 'Reference: {id}',

  /* ── Signing in ────────────────────────────────────────────────────────── */
  'auth.checking': 'Checking who you are…',
  'auth.completing': 'Signing you in…',
  'auth.signInTitle': 'Sign in to FeedbackHub',
  'auth.signInHint':
    'Signing in happens on a separate page, and you are brought back here afterwards.',
  'auth.signIn': 'Sign in',
  'auth.registerLead': 'First time here?',
  'auth.register': 'Create an account',
  'auth.registerHint':
    'You choose a password on the same page and confirm your email address. Whether this board admits a new account is decided when you come back — if it does not, it says why.',
  'auth.refusedTitle': 'This board has not given you an account',
  'auth.signOut': 'Sign out',
  'auth.unavailable': 'Sign-in is unavailable',

  'nav.primary': 'Primary',
  'nav.board': 'Board',
  'nav.newRequest': 'New request',
  'nav.categories': 'Categories',
  'nav.settings': 'Settings',
  'nav.pending': 'Waiting',
  'nav.pendingLabel': '{count} comments waiting for approval',

  /* ── Words used on more than one screen ────────────────────────────────── */
  'common.tryAgain': 'Try again',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.backToBoard': '← Back to the board',
  'common.loading': 'Loading…',
  'common.saved': 'Saved.',
  'common.savingNow': 'Saving.',

  /* ── The board ─────────────────────────────────────────────────────────── */
  'board.title': 'Feedback requests',
  'board.loading': 'Loading requests…',
  'board.loadFailed': 'The board could not be loaded',
  'board.empty': 'No requests yet',
  'board.emptyHint': 'Be the first to ask for something.',
  'board.emptyFiltered': 'Nothing matches these filters',
  'board.emptyFilteredHint': 'Try removing one of them, or clear them all.',
  'board.fileFirst': 'File the first request',
  'board.votes': '{count} votes',
  'board.oneVote': '1 vote',
  'board.comments': '{count} comments',
  'board.oneComment': '1 comment',
  'board.by': 'by {name}',
  'board.pinned': 'Pinned',
  'board.edited': 'edited',
  'board.vote': 'Vote',
  'board.voted': 'Voted',
  'board.page': 'Page {page} of {total}',
  'board.previous': 'Previous',
  'board.next': 'Next',
  'board.pagination': 'Pagination',
  'board.showing': 'Showing {from}–{to} of {total}',

  'board.subtitle':
    'Most wanted first. Vote for what you need instead of filing it again — the count is how priority gets decided.',
  'board.a11yLoading': 'Loading requests.',
  'board.a11yUpdating': 'Updating results.',
  'board.a11yFailed': 'Requests could not be loaded.',
  'board.a11yNoMatches': 'No requests match these filters.',
  'board.a11yShowing': 'Showing {from} to {to} of {total}, page {page} of {pages}.',
  'board.loadFailedTitle': 'Requests could not be loaded',
  'board.emptyTitle': 'Nothing here yet',
  'board.emptyBody':
    'No one has filed a request. The first one sets the tone — be specific about the problem rather than the solution.',
  'board.noMatchesTitle': 'Nothing matches these filters',
  'board.noMatchesBody':
    'There are requests on the board, just none that match what you asked for. Widen the filters or clear them to see everything.',
  'board.clearAll': 'Clear all filters',
  'board.pastEndTitle': 'That page does not exist',
  'board.pastEndBody': 'There are only {pages} pages of results.',
  'board.pastEndOne': 'There is only 1 page of results.',
  'board.backToFirst': 'Back to the first page',
  'board.cannotVoteOwn': 'You cannot vote on your own request.',
  'board.pinLabel': 'Pin {title} to the top of the board',
  'board.summary': 'Showing {from}–{to} of {total}',
  'board.summaryFiltered': 'Showing {from}–{to} of {total} matching your filters',

  /* ── The pinned shelf ──────────────────────────────────────────────────── */
  'pinned.title': 'Pinned',
  'pinned.subtitle': 'Kept at the top by an admin.',
  'pinned.showAll': 'Show all {count}',
  'pinned.showFewer': 'Show fewer',
  'pinned.pinnedBy': 'Pinned by {name}',
  'pinned.unpin': 'Unpin',
  'pinned.pin': 'Pin',

  /* ── Filters ───────────────────────────────────────────────────────────── */
  'filter.title': 'Filter',
  'filter.search': 'Search',
  'filter.searchPlaceholder': 'Search requests…',
  'filter.status': 'Status',
  'filter.category': 'Category',
  'filter.mine': 'Only mine',
  'filter.sort': 'Order',
  'filter.sortVotes': 'Most voted',
  'filter.sortNewest': 'Newest first',
  'filter.sortOldest': 'Oldest first',
  'filter.clear': 'Clear filters',
  'filter.matches': '{count} matching',
  'filter.oneMatch': '1 matching',
  'filter.searchTooShort': 'Type at least {min} characters to search.',

  'filter.heading': 'Filter and sort',
  'filter.searchPlaceholder2': 'Title or description',
  'filter.searchHint':
    'Results update as you type, from two characters. Enter searches straight away.',
  'filter.loadingStatuses': 'Loading statuses…',
  'filter.loadingCategories': 'Loading categories…',
  'filter.onlyMine': 'Only my requests',
  'filter.sortBy': 'Sort by',
  'filter.filtering': 'Filtering…',
  'filter.matchCount': '{count} requests match these filters.',
  'filter.matchCountOne': '1 request matches these filters.',
  'filter.pinnedNote': 'Pinned requests that match are listed first, not on the shelf.',

  /* ── A request ─────────────────────────────────────────────────────────── */
  'request.new': 'New request',
  'request.title': 'Title',
  'request.description': 'Description',
  'request.category': 'Category',
  'request.chooseCategory': 'Choose a category',
  'request.submit': 'File this request',
  'request.submitting': 'Filing…',
  'request.titleRequired': 'A title is required.',
  'request.titleTooShort': 'A title needs at least {min} characters.',
  'request.titleTooLong': 'A title cannot be longer than {max} characters.',
  'request.descriptionRequired': 'A description is required.',
  'request.descriptionTooShort': 'A description needs at least {min} characters.',
  'request.descriptionTooLong': 'A description cannot be longer than {max} characters.',
  'request.categoryRequired': 'Choose a category.',
  'request.rateLimited': 'You can file another {wait}.',

  'pinned.note': 'Kept at the top by an admin, regardless of votes.',
  'pinned.unpinLabel': 'Unpin {title}',
  'pinned.showLess': 'Show less',
  'pinned.showMore': 'Show {count} more',

  'create.heading': 'New request',
  'create.subtitle':
    'Check the board first — if someone has already asked for this, vote on theirs instead.',
  'create.notSaved': 'The request was not saved',
  'create.titleHint': 'One sentence. What is the problem or the change you want?',
  'create.descriptionHint':
    'What is happening now, what should happen instead, and who it affects.',
  'create.submit': 'Submit request',
  'create.submitting': 'Submitting…',
  'create.submittingA11y': 'Submitting the request.',
  'create.titleRequired': 'Give the request a title.',
  'create.titleMin': 'The title must be at least {min} characters.',
  'create.titleMax': 'The title cannot be longer than {max} characters.',
  'create.titleInvalid': 'That title is not valid.',
  'create.descriptionRequired': 'Describe what you are asking for.',
  'create.descriptionMin': 'Use at least {min} characters so others can judge the request.',
  'create.descriptionMax': 'The description cannot be longer than {max} characters.',
  'create.descriptionInvalid': 'That description is not valid.',
  'create.categoryRequired': 'Choose a category.',
  'edit.heading': 'Edit this request',

  'detail.loading': 'Loading the request…',
  'detail.loadFailed': 'This request could not be loaded',
  'detail.notFound': 'That request does not exist.',
  'detail.filedBy': 'Filed by {name}',
  'detail.editedOn': 'Edited {date}',
  'detail.manage': 'Manage',
  'detail.changeStatus': 'Status',
  'detail.applyStatus': 'Change status',
  'detail.editRequest': 'Edit request',
  'detail.deleteRequest': 'Delete request',
  'detail.deleteTitle': 'Delete this request?',
  'detail.deleteBody':
    'The request, its votes and its whole discussion are removed. This cannot be undone.',
  'detail.editTitle': 'Edit your request',
  'detail.saveChanges': 'Save changes',

  'detail.notFoundTitle': 'That request does not exist',
  'detail.loadFailedTitle': 'The request could not be loaded',
  'detail.a11yPin': 'Updating the pin.',
  'detail.a11yDelete': 'Deleting the request.',
  'detail.manageHeading': 'Manage this request',
  'detail.updateStatus': 'Update status',
  'detail.working': 'Working…',
  'detail.unpinFromBoard': 'Unpin from the board',
  'detail.pinToBoard': 'Pin to the board',
  'detail.deleteBodyLong':
    'This removes the request, its votes and every comment on it. That cannot be undone.',

  /* ── Comments ──────────────────────────────────────────────────────────── */
  'comment.heading': 'Discussion',
  'comment.add': 'Add a comment',
  'comment.placeholder': 'Add to the discussion…',
  'comment.post': 'Comment',
  'comment.posting': 'Posting…',
  'comment.reply': 'Reply',
  'comment.replyPlaceholder': 'Write a reply…',
  'comment.loading': 'Loading the discussion…',
  'comment.loadFailed': 'The discussion could not be loaded',
  'comment.empty': 'No comments yet. Start the discussion.',
  'comment.required': 'Write something first.',
  'comment.tooLong': 'A comment cannot be longer than {max} characters.',
  'comment.edited': 'edited',
  'comment.editedTitle': 'This comment was edited',
  'comment.removedByAuthor': 'The author removed this comment.',
  'comment.removedByAdmin': 'An admin removed this comment.',
  'comment.removedWithParent': 'Removed with the comment it answered.',
  'comment.deleteTitle': 'Remove this comment?',
  'comment.deleteBody': 'This cannot be undone.',
  'comment.awaitingApproval':
    'Comments on this board are approved by an admin before anybody else sees them. Yours will be visible to you while it waits.',
  'comment.pending': 'Waiting for approval',
  'comment.approve': 'Approve',
  'comment.reject': 'Reject',
  'comment.rejectTitle': 'Reject this comment?',
  'comment.rejectBody':
    'It is removed from the discussion and its author is told an admin removed it. This cannot be undone.',
  'board.pendingFilter': 'Requests with comments waiting for approval.',

  'comment.emptyLong':
    'No comments yet. If this request needs detail or a counter-argument, this is where it goes.',
  'comment.editComment': 'Edit comment',
  'comment.editReply': 'Edit reply',
  'comment.editedReplyTitle': 'This reply was edited',
  'comment.removedWithParentLong': 'Removed along with the comment it replied to.',
  'comment.deleteCommentTitle': 'Remove this comment?',
  'comment.deleteReplyTitle': 'Remove this reply?',

  /* ── The account screen ────────────────────────────────────────────────── */
  'account.title': 'Your account',
  'account.loading': 'Loading your settings…',
  'account.loadFailed': 'Your settings could not be loaded',
  'account.whoYouAre': 'Who you are',
  'account.displayName': 'Display name',
  'account.displayNameRequired': 'A display name is required.',
  'account.emailNote':
    'Your email is {email}. It comes from the account you signed in with and is not editable here.',
  'account.saveName': 'Save name',
  'account.looks': 'How the board looks',
  'account.opens': 'How the board opens for you',
  'account.opensNote':
    'Your own starting point, which overrides whatever the board is set to. Leave one on the board default and it follows the admin’s choice as that changes.',
  'account.email': 'Email',
  'account.emailIntro':
    'These are recorded against the day this application can send mail. Nothing sends any today, and this screen would rather say so than imply otherwise.',
  'account.deleteHeading': 'Delete your account',
  'account.deleteIntro': 'Deleting your account cannot be undone. Here is exactly what happens:',
  'account.deleteName': 'Your name and email are erased from this board.',
  'account.deleteContent': 'Your requests and comments stay, shown as written by a deleted user.',
  'account.deleteVotes': 'Votes you cast stay counted.',
  'account.deletePrefs': 'Your preferences on this screen are deleted.',
  'account.deleteSignIn': 'You cannot sign in again with this account.',
  'account.deleteButton': 'Delete my account',
  'account.deleteTitle': 'Delete your account?',
  'account.deleteBody':
    'Your name and email are erased and you cannot sign in again. Your requests and comments stay on the board, shown as written by a deleted user, and your votes stay counted. This cannot be undone.',

  /* ── Where a setting's value came from ─────────────────────────────────── */
  'setting.sourceGlobal': 'Set for everybody',
  'setting.sourceGlobalUnset': 'Not set — using the built-in default',
  'setting.sourceUser': 'Your choice',
  'setting.sourceFollowing': 'Following the board default',
  'setting.sourceDefault': 'Using the default',
  'setting.resetGlobal': 'Use the built-in default',
  'setting.resetUser': 'Use the board default',
  'setting.noneToChoose': 'There are none to choose from yet.',

  /* ── The administrative screens ────────────────────────────────────────── */
  'admin.settingsTitle': 'Application settings',
  'admin.settingsLoading': 'Loading the settings…',
  'admin.settingsLoadFailed': 'The settings could not be loaded',
  'admin.forAdmins': 'This screen is for admins',
  'admin.registration': 'Who may create an account',
  'admin.registrationNote':
    'Checked when somebody arrives for the first time. Signing in successfully and being admitted here are two different decisions, and this is the second one.',
  'admin.comments': 'Comments',
  'admin.queue': 'Waiting for approval',
  'admin.queueOpenNote':
    'Approval is off, so these are visible to everybody already. Approving one just settles it.',
  'admin.queueEmpty': 'Nothing is waiting.',
  'admin.approve': 'Approve',
  'admin.on': 'on',
  'admin.limits': 'How often anybody may post',
  'admin.boardDefaults': 'How the board opens for everybody',
  'admin.boardDefaultsNote':
    'The starting point for everybody who has not chosen their own. The same three settings appear on each person’s own account screen, and a choice made there wins over what is set here.',

  'taxonomy.title': 'Categories and statuses',
  'taxonomy.loading': 'Loading the taxonomy…',
  'taxonomy.loadFailed': 'The taxonomy could not be loaded',
  'taxonomy.intro':
    'The order set here is the order these appear in everywhere: the filters, the create form and the status selector on a request.',
  'taxonomy.categories': 'Categories',
  'taxonomy.statuses': 'Statuses',
  'taxonomy.name': 'Name',
  'taxonomy.slug': 'Slug',
  'taxonomy.usage': 'Requests',
  'taxonomy.order': 'Order',
  'taxonomy.add': 'Add',
  'taxonomy.rename': 'Rename',
  'taxonomy.moveUp': 'Move up',
  'taxonomy.moveDown': 'Move down',
  'taxonomy.retire': 'Retire',
  'taxonomy.restore': 'Restore',
  'taxonomy.makeDefault': 'Make default',
  'taxonomy.isDefault': 'Default',
  'taxonomy.retired': 'Retired',
  'taxonomy.savingA11y': 'Saving a change.',
  'taxonomy.renameLabel': 'New name for {name}',
  'taxonomy.moveUpLabel': 'Move {name} up',
  'taxonomy.moveDownLabel': 'Move {name} down',
  'taxonomy.renameRow': 'Rename {name}',
  'taxonomy.addHeadingCategory': 'Add a category',
  'taxonomy.addHeadingStatus': 'Add a status',
  'taxonomy.addCategory': 'Add category',
  'taxonomy.addStatus': 'Add status',
  'taxonomy.working': 'Working…',
  'taxonomy.slugHint': 'Suggested from the name. Permanent once created — it goes in shared links.',
  'taxonomy.retireTitle': 'Retire {name}?',
  'taxonomy.retireConfirm': 'Retire it',
  'taxonomy.retireBody':
    '{name} stops being offered on the create and edit forms and in the filters. {usage} It can be restored.',
  'taxonomy.retireUnused': 'Nothing uses it yet.',
  'taxonomy.retireUsed': '{count} requests keep it and go on showing it.',
  'taxonomy.retireUsedOne': '1 request keeps it and goes on showing it.',
  'taxonomy.savingCategories': 'Saving a change to the categories.',
  'taxonomy.savingStatuses': 'Saving a change to the statuses.',
} as const;

export type MessageKey = keyof typeof english;

/**
 * Typed against the English keys, so a missing one is a compile error.
 *
 * Written to be read by somebody who speaks French rather than transliterated
 * from the English: "Filer" is not what you do to a request, and a "tableau"
 * is what this board is called.
 */
const french: Record<MessageKey, string> = {
  'app.skipToContent': 'Aller au contenu principal',
  'app.tagline': 'Retours produit internes',
  'app.starting': 'Démarrage de FeedbackHub…',
  'app.startFailed': 'FeedbackHub n’a pas pu démarrer',
  'app.reference': 'Référence : {id}',

  /* ── Signing in ────────────────────────────────────────────────────────── */
  'auth.checking': 'Vérification de votre identité…',
  'auth.completing': 'Connexion en cours…',
  'auth.signInTitle': 'Connectez-vous à FeedbackHub',
  'auth.signInHint': 'La connexion se fait sur une page distincte, puis vous êtes ramené ici.',
  'auth.signIn': 'Se connecter',
  'auth.registerLead': 'Première visite ?',
  'auth.register': 'Créer un compte',
  'auth.registerHint':
    'Vous choisissez un mot de passe sur cette même page et confirmez votre adresse e-mail. L’admission d’un nouveau compte sur ce tableau est décidée à votre retour — en cas de refus, la raison est indiquée.',
  'auth.refusedTitle': 'Ce tableau ne vous a pas attribué de compte',
  'auth.signOut': 'Se déconnecter',
  'auth.unavailable': 'La connexion est indisponible',

  'nav.primary': 'Principale',
  'nav.board': 'Tableau',
  'nav.newRequest': 'Nouvelle demande',
  'nav.categories': 'Catégories',
  'nav.settings': 'Paramètres',
  'nav.pending': 'En attente',
  'nav.pendingLabel': '{count} commentaires en attente d’approbation',

  'common.tryAgain': 'Réessayer',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.saving': 'Enregistrement…',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.backToBoard': '← Retour au tableau',
  'common.loading': 'Chargement…',
  'common.saved': 'Enregistré.',
  'common.savingNow': 'Enregistrement en cours.',

  'board.title': 'Demandes',
  'board.loading': 'Chargement des demandes…',
  'board.loadFailed': 'Le tableau n’a pas pu être chargé',
  'board.empty': 'Aucune demande pour l’instant',
  'board.emptyHint': 'Soyez le premier à demander quelque chose.',
  'board.emptyFiltered': 'Aucun résultat pour ces filtres',
  'board.emptyFilteredHint': 'Essayez d’en retirer un, ou effacez-les tous.',
  'board.fileFirst': 'Déposer la première demande',
  'board.votes': '{count} votes',
  'board.oneVote': '1 vote',
  'board.comments': '{count} commentaires',
  'board.oneComment': '1 commentaire',
  'board.by': 'par {name}',
  'board.pinned': 'Épinglée',
  'board.edited': 'modifiée',
  'board.vote': 'Voter',
  'board.voted': 'Voté',
  'board.page': 'Page {page} sur {total}',
  'board.previous': 'Précédent',
  'board.next': 'Suivant',
  'board.pagination': 'Pagination',
  'board.showing': 'Affichage de {from} à {to} sur {total}',

  'board.subtitle':
    'Les plus demandées d’abord. Votez pour ce dont vous avez besoin plutôt que de le redemander — c’est le nombre de votes qui décide des priorités.',
  'board.a11yLoading': 'Chargement des demandes.',
  'board.a11yUpdating': 'Mise à jour des résultats.',
  'board.a11yFailed': 'Les demandes n’ont pas pu être chargées.',
  'board.a11yNoMatches': 'Aucune demande ne correspond à ces filtres.',
  'board.a11yShowing': 'Affichage de {from} à {to} sur {total}, page {page} sur {pages}.',
  'board.loadFailedTitle': 'Les demandes n’ont pas pu être chargées',
  'board.emptyTitle': 'Rien pour l’instant',
  'board.emptyBody':
    'Personne n’a encore déposé de demande. La première donne le ton — soyez précis sur le problème plutôt que sur la solution.',
  'board.noMatchesTitle': 'Aucun résultat pour ces filtres',
  'board.noMatchesBody':
    'Il y a bien des demandes sur le tableau, mais aucune ne correspond à votre recherche. Élargissez les filtres ou effacez-les pour tout voir.',
  'board.clearAll': 'Effacer tous les filtres',
  'board.pastEndTitle': 'Cette page n’existe pas',
  'board.pastEndBody': 'Il n’y a que {pages} pages de résultats.',
  'board.pastEndOne': 'Il n’y a qu’une seule page de résultats.',
  'board.backToFirst': 'Retour à la première page',
  'board.cannotVoteOwn': 'Vous ne pouvez pas voter pour votre propre demande.',
  'board.pinLabel': 'Épingler {title} en haut du tableau',
  'board.summary': 'Affichage de {from} à {to} sur {total}',
  'board.summaryFiltered': 'Affichage de {from} à {to} sur {total} correspondant à vos filtres',

  'pinned.title': 'Épinglées',
  'pinned.subtitle': 'Maintenues en haut par un administrateur.',
  'pinned.showAll': 'Afficher les {count}',
  'pinned.showFewer': 'Afficher moins',
  'pinned.pinnedBy': 'Épinglée par {name}',
  'pinned.unpin': 'Désépingler',
  'pinned.pin': 'Épingler',

  'filter.title': 'Filtrer',
  'filter.search': 'Rechercher',
  'filter.searchPlaceholder': 'Rechercher une demande…',
  'filter.status': 'Statut',
  'filter.category': 'Catégorie',
  'filter.mine': 'Les miennes seulement',
  'filter.sort': 'Ordre',
  'filter.sortVotes': 'Les plus votées',
  'filter.sortNewest': 'Les plus récentes',
  'filter.sortOldest': 'Les plus anciennes',
  'filter.clear': 'Effacer les filtres',
  'filter.matches': '{count} résultats',
  'filter.oneMatch': '1 résultat',
  'filter.searchTooShort': 'Saisissez au moins {min} caractères pour rechercher.',

  'filter.heading': 'Filtrer et trier',
  'filter.searchPlaceholder2': 'Titre ou description',
  'filter.searchHint':
    'Les résultats se mettent à jour à la saisie, à partir de deux caractères. Entrée lance la recherche immédiatement.',
  'filter.loadingStatuses': 'Chargement des statuts…',
  'filter.loadingCategories': 'Chargement des catégories…',
  'filter.onlyMine': 'Mes demandes seulement',
  'filter.sortBy': 'Trier par',
  'filter.filtering': 'Filtrage…',
  'filter.matchCount': '{count} demandes correspondent à ces filtres.',
  'filter.matchCountOne': '1 demande correspond à ces filtres.',
  'filter.pinnedNote':
    'Les demandes épinglées qui correspondent sont listées en premier, et non sur l’étagère.',

  'request.new': 'Nouvelle demande',
  'request.title': 'Titre',
  'request.description': 'Description',
  'request.category': 'Catégorie',
  'request.chooseCategory': 'Choisissez une catégorie',
  'request.submit': 'Déposer la demande',
  'request.submitting': 'Dépôt…',
  'request.titleRequired': 'Un titre est obligatoire.',
  'request.titleTooShort': 'Un titre doit compter au moins {min} caractères.',
  'request.titleTooLong': 'Un titre ne peut pas dépasser {max} caractères.',
  'request.descriptionRequired': 'Une description est obligatoire.',
  'request.descriptionTooShort': 'Une description doit compter au moins {min} caractères.',
  'request.descriptionTooLong': 'Une description ne peut pas dépasser {max} caractères.',
  'request.categoryRequired': 'Choisissez une catégorie.',
  'request.rateLimited': 'Vous pourrez en déposer une autre {wait}.',

  'pinned.note': 'Maintenues en haut par un administrateur, indépendamment des votes.',
  'pinned.unpinLabel': 'Désépingler {title}',
  'pinned.showLess': 'Afficher moins',
  'pinned.showMore': 'Afficher {count} de plus',

  'create.heading': 'Nouvelle demande',
  'create.subtitle':
    'Regardez d’abord le tableau — si quelqu’un l’a déjà demandé, votez pour sa demande plutôt que d’en créer une autre.',
  'create.notSaved': 'La demande n’a pas été enregistrée',
  'create.titleHint': 'Une phrase. Quel est le problème ou le changement souhaité ?',
  'create.descriptionHint':
    'Ce qui se passe aujourd’hui, ce qui devrait se passer, et qui est concerné.',
  'create.submit': 'Envoyer la demande',
  'create.submitting': 'Envoi…',
  'create.submittingA11y': 'Envoi de la demande.',
  'create.titleRequired': 'Donnez un titre à la demande.',
  'create.titleMin': 'Le titre doit compter au moins {min} caractères.',
  'create.titleMax': 'Le titre ne peut pas dépasser {max} caractères.',
  'create.titleInvalid': 'Ce titre n’est pas valide.',
  'create.descriptionRequired': 'Décrivez ce que vous demandez.',
  'create.descriptionMin':
    'Utilisez au moins {min} caractères pour que les autres puissent juger la demande.',
  'create.descriptionMax': 'La description ne peut pas dépasser {max} caractères.',
  'create.descriptionInvalid': 'Cette description n’est pas valide.',
  'create.categoryRequired': 'Choisissez une catégorie.',
  'edit.heading': 'Modifier cette demande',

  'detail.loading': 'Chargement de la demande…',
  'detail.loadFailed': 'Cette demande n’a pas pu être chargée',
  'detail.notFound': 'Cette demande n’existe pas.',
  'detail.filedBy': 'Déposée par {name}',
  'detail.editedOn': 'Modifiée le {date}',
  'detail.manage': 'Gérer',
  'detail.changeStatus': 'Statut',
  'detail.applyStatus': 'Changer le statut',
  'detail.editRequest': 'Modifier la demande',
  'detail.deleteRequest': 'Supprimer la demande',
  'detail.deleteTitle': 'Supprimer cette demande ?',
  'detail.deleteBody':
    'La demande, ses votes et toute sa discussion sont supprimés. Cette action est irréversible.',
  'detail.editTitle': 'Modifier votre demande',
  'detail.saveChanges': 'Enregistrer les modifications',

  'detail.notFoundTitle': 'Cette demande n’existe pas',
  'detail.loadFailedTitle': 'La demande n’a pas pu être chargée',
  'detail.a11yPin': 'Mise à jour de l’épinglage.',
  'detail.a11yDelete': 'Suppression de la demande.',
  'detail.manageHeading': 'Gérer cette demande',
  'detail.updateStatus': 'Mettre à jour le statut',
  'detail.working': 'En cours…',
  'detail.unpinFromBoard': 'Retirer du haut du tableau',
  'detail.pinToBoard': 'Épingler en haut du tableau',
  'detail.deleteBodyLong':
    'Cela supprime la demande, ses votes et tous ses commentaires. Cette action est irréversible.',
  'comment.heading': 'Discussion',
  'comment.add': 'Ajouter un commentaire',
  'comment.placeholder': 'Ajouter à la discussion…',
  'comment.post': 'Commenter',
  'comment.posting': 'Envoi…',
  'comment.reply': 'Répondre',
  'comment.replyPlaceholder': 'Écrire une réponse…',
  'comment.loading': 'Chargement de la discussion…',
  'comment.loadFailed': 'La discussion n’a pas pu être chargée',
  'comment.empty': 'Aucun commentaire. Lancez la discussion.',
  'comment.required': 'Écrivez quelque chose d’abord.',
  'comment.tooLong': 'Un commentaire ne peut pas dépasser {max} caractères.',
  'comment.edited': 'modifié',
  'comment.editedTitle': 'Ce commentaire a été modifié',
  'comment.removedByAuthor': 'L’auteur a supprimé ce commentaire.',
  'comment.removedByAdmin': 'Un administrateur a supprimé ce commentaire.',
  'comment.removedWithParent': 'Supprimé avec le commentaire auquel il répondait.',
  'comment.deleteTitle': 'Supprimer ce commentaire ?',
  'comment.deleteBody': 'Cette action est irréversible.',
  'comment.awaitingApproval':
    'Sur ce tableau, les commentaires sont approuvés par un administrateur avant que quiconque ne les voie. Le vôtre restera visible pour vous en attendant.',
  'comment.pending': 'En attente d’approbation',
  'comment.approve': 'Approuver',
  'comment.reject': 'Rejeter',
  'comment.rejectTitle': 'Rejeter ce commentaire ?',
  'comment.rejectBody':
    'Il est retiré de la discussion et son auteur est informé qu’un administrateur l’a supprimé. Cette action est irréversible.',
  'board.pendingFilter': 'Demandes dont des commentaires attendent une approbation.',

  'comment.emptyLong':
    'Aucun commentaire pour l’instant. Si cette demande a besoin de précisions ou d’un contre-argument, c’est ici.',
  'comment.editComment': 'Modifier le commentaire',
  'comment.editReply': 'Modifier la réponse',
  'comment.editedReplyTitle': 'Cette réponse a été modifiée',
  'comment.removedWithParentLong': 'Supprimé en même temps que le commentaire auquel il répondait.',
  'comment.deleteCommentTitle': 'Supprimer ce commentaire ?',
  'comment.deleteReplyTitle': 'Supprimer cette réponse ?',

  'account.title': 'Votre compte',
  'account.loading': 'Chargement de vos paramètres…',
  'account.loadFailed': 'Vos paramètres n’ont pas pu être chargés',
  'account.whoYouAre': 'Qui vous êtes',
  'account.displayName': 'Nom affiché',
  'account.displayNameRequired': 'Un nom affiché est obligatoire.',
  'account.emailNote':
    'Votre adresse est {email}. Elle provient du compte utilisé pour vous connecter et ne se modifie pas ici.',
  'account.saveName': 'Enregistrer le nom',
  'account.looks': 'L’apparence du tableau',
  'account.opens': 'L’ouverture du tableau, pour vous',
  'account.opensNote':
    'Votre point de départ, qui l’emporte sur le réglage du tableau. Laissez-en un sur la valeur du tableau et il suivra le choix de l’administrateur à mesure qu’il change.',
  'account.email': 'E-mail',
  'account.emailIntro':
    'Ces préférences sont enregistrées en prévision du jour où cette application pourra envoyer des e-mails. Rien n’en envoie aujourd’hui, et cet écran préfère le dire plutôt que de laisser croire le contraire.',
  'account.deleteHeading': 'Supprimer votre compte',
  'account.deleteIntro':
    'La suppression de votre compte est irréversible. Voici exactement ce qui se passe :',
  'account.deleteName': 'Votre nom et votre adresse e-mail sont effacés de ce tableau.',
  'account.deleteContent':
    'Vos demandes et vos commentaires restent, signés par un utilisateur supprimé.',
  'account.deleteVotes': 'Les votes que vous avez émis restent comptés.',
  'account.deletePrefs': 'Vos préférences sur cet écran sont supprimées.',
  'account.deleteSignIn': 'Vous ne pourrez plus vous connecter avec ce compte.',
  'account.deleteButton': 'Supprimer mon compte',
  'account.deleteTitle': 'Supprimer votre compte ?',
  'account.deleteBody':
    'Votre nom et votre adresse e-mail sont effacés et vous ne pourrez plus vous connecter. Vos demandes et vos commentaires restent sur le tableau, signés par un utilisateur supprimé, et vos votes restent comptés. Cette action est irréversible.',

  'setting.sourceGlobal': 'Défini pour tout le monde',
  'setting.sourceGlobalUnset': 'Non défini — valeur d’origine de l’application',
  'setting.sourceUser': 'Votre choix',
  'setting.sourceFollowing': 'Suit le réglage du tableau',
  'setting.sourceDefault': 'Valeur par défaut',
  'setting.resetGlobal': 'Revenir à la valeur d’origine',
  'setting.resetUser': 'Revenir au réglage du tableau',
  'setting.noneToChoose': 'Il n’y en a encore aucun à choisir.',

  'admin.settingsTitle': 'Paramètres de l’application',
  'admin.settingsLoading': 'Chargement des paramètres…',
  'admin.settingsLoadFailed': 'Les paramètres n’ont pas pu être chargés',
  'admin.forAdmins': 'Cet écran est réservé aux administrateurs',
  'admin.registration': 'Qui peut créer un compte',
  'admin.registrationNote':
    'Vérifié lorsque quelqu’un arrive pour la première fois. Se connecter et être admis ici sont deux décisions différentes, et voici la seconde.',
  'admin.comments': 'Commentaires',
  'admin.queue': 'En attente d’approbation',
  'admin.queueOpenNote':
    'L’approbation est désactivée : ces commentaires sont déjà visibles par tout le monde. Les approuver ne fait que clore la question.',
  'admin.queueEmpty': 'Rien n’est en attente.',
  'admin.approve': 'Approuver',
  'admin.on': 'sur',
  'admin.limits': 'À quelle fréquence chacun peut publier',
  'admin.boardDefaults': 'L’ouverture du tableau, pour tout le monde',
  'admin.boardDefaultsNote':
    'Le point de départ de tous ceux qui n’ont pas choisi le leur. Ces trois mêmes réglages figurent sur l’écran de compte de chacun, et un choix fait là-bas l’emporte sur ce qui est défini ici.',

  'taxonomy.title': 'Catégories et statuts',
  'taxonomy.loading': 'Chargement de la taxonomie…',
  'taxonomy.loadFailed': 'La taxonomie n’a pas pu être chargée',
  'taxonomy.intro':
    'L’ordre défini ici est celui dans lequel ces éléments apparaissent partout : les filtres, le formulaire de création et le sélecteur de statut d’une demande.',
  'taxonomy.categories': 'Catégories',
  'taxonomy.statuses': 'Statuts',
  'taxonomy.name': 'Nom',
  'taxonomy.slug': 'Identifiant',
  'taxonomy.usage': 'Demandes',
  'taxonomy.order': 'Ordre',
  'taxonomy.add': 'Ajouter',
  'taxonomy.rename': 'Renommer',
  'taxonomy.moveUp': 'Monter',
  'taxonomy.moveDown': 'Descendre',
  'taxonomy.retire': 'Retirer',
  'taxonomy.restore': 'Rétablir',
  'taxonomy.makeDefault': 'Définir par défaut',
  'taxonomy.isDefault': 'Par défaut',
  'taxonomy.retired': 'Retirée',
  'taxonomy.savingA11y': 'Enregistrement d’une modification.',
  'taxonomy.renameLabel': 'Nouveau nom pour {name}',
  'taxonomy.moveUpLabel': 'Monter {name}',
  'taxonomy.moveDownLabel': 'Descendre {name}',
  'taxonomy.renameRow': 'Renommer {name}',
  'taxonomy.addHeadingCategory': 'Ajouter une catégorie',
  'taxonomy.addHeadingStatus': 'Ajouter un statut',
  'taxonomy.addCategory': 'Ajouter la catégorie',
  'taxonomy.addStatus': 'Ajouter le statut',
  'taxonomy.working': 'En cours…',
  'taxonomy.slugHint':
    'Proposé à partir du nom. Définitif une fois créé — il figure dans les liens partagés.',
  'taxonomy.retireTitle': 'Retirer {name} ?',
  'taxonomy.retireConfirm': 'Retirer',
  'taxonomy.retireBody':
    '{name} ne sera plus proposé dans les formulaires de création et de modification ni dans les filtres. {usage} Cela peut être annulé.',
  'taxonomy.retireUnused': 'Rien ne l’utilise pour l’instant.',
  'taxonomy.retireUsed': '{count} demandes le conservent et continuent de l’afficher.',
  'taxonomy.retireUsedOne': '1 demande le conserve et continue de l’afficher.',
  'taxonomy.savingCategories': 'Enregistrement d’une modification des catégories.',
  'taxonomy.savingStatuses': 'Enregistrement d’une modification des statuts.',
};

export const MESSAGES = { en: english, fr: french } as const;

export type Language = keyof typeof MESSAGES;
