; Blocks world problem
(define (problem blocks-4-0)
  (:domain blocks)
  (:objects a b c d - block)
  (:init
    (ontable a)
    (ontable b)
    (on c a)
    (on d b)
    (clear c)
    (clear d)
    (handempty))
  (:goal
    (and
      (on a b)
      (on b c)
      (on c d))))
