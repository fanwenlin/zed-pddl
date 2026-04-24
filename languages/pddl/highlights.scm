["(" ")"] @punctuation.bracket

(comment) @comment

(keyword) @keyword
(number) @number
(dash) @operator

(optimization) @keyword
(time_specifier) @keyword
(total_time) @constant.builtin
(duration_variable) @variable.special

(domain_header
  (name) @module)

(problem_header
  (name) @module)

(domain_reference_section
  (domain_name) @module)

(action_definition
  (action_name) @function.method)

(durative_action_definition
  (action_name) @function.method)

(predicate_definition
  (predicate_name) @function.builtin)

(atomic_formula
  (predicate_name) @function.builtin)

(derived_definition
  (predicate_definition
    (predicate_name) @function.builtin))

(function_definition
  (function_name) @function)

(function_call
  (function_name) @function)

(metric_expression
  (function_name) @function)

(typed_name_group
  (type_name) @type.builtin)

(function_definition
  (type_name) @type.builtin)

(either_type
  (type_name) @type.builtin)

(constant_name) @constant
(object_name) @constant

(parameter) @variable.parameter
(variable) @variable.special

(symbol_name) @constant
(name) @constant
