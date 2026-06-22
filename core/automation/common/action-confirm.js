class ActionConfirmation {
  confirm(result = {}) {
    return {
      confirmed: Boolean(result.success),
      success: Boolean(result.success),
      error: result.error || null,
      data: result.data || null
    };
  }
}

module.exports = ActionConfirmation;
